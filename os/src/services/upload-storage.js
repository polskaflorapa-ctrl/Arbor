const fs = require('fs');
const os = require('os');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { getUploadsRoot } = require('../config/uploadPaths');

const STORAGE_MODES = new Set(['local', 's3']);

function uploadStorageMode() {
  const value = String(env.UPLOAD_STORAGE || 'local').trim().toLowerCase();
  return STORAGE_MODES.has(value) ? value : 'local';
}

function getS3Client() {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('Missing S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY for upload storage.');
  }
  if (!env.S3_PUBLIC_BASE_URL) {
    throw new Error('Missing S3_PUBLIC_BASE_URL. Upload images need a public URL for web/mobile previews.');
  }

  const endpoint = env.S3_ENDPOINT ? String(env.S3_ENDPOINT).trim() : undefined;
  const forcePathStyle =
    env.S3_FORCE_PATH_STYLE === true ||
    env.S3_FORCE_PATH_STYLE === 'true' ||
    (endpoint && endpoint.includes('r2.cloudflarestorage.com'));

  return new S3Client({
    region: env.S3_REGION || 'auto',
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!forcePathStyle,
  });
}

function safeSegment(value, fallback) {
  const raw = String(value || fallback || '').trim();
  const cleaned = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-'))
    .filter(Boolean)
    .join('/');
  return cleaned || fallback;
}

function encodedPublicUrl(publicBase, key) {
  const base = String(publicBase || '').replace(/\/+$/, '');
  const encodedKey = String(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/${encodedKey}`;
}

function localUploadUrl(folder, fileName) {
  return `/uploads/${safeSegment(folder, 'files')}/${safeSegment(fileName, 'upload.bin')}`;
}

function cleanupLocalFile(fileOrPath) {
  const localPath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
  if (!localPath) return;
  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch (error) {
    logger.warn('upload.local.cleanup', { message: error.message, path: localPath });
  }
}

async function persistUploadedFile(file, { folder, fileName } = {}) {
  if (!file?.path) throw new Error('Uploaded file is missing a temporary path.');

  const finalFolder = safeSegment(folder, 'files');
  const finalName = safeSegment(fileName || file.filename || path.basename(file.path), 'upload.bin');
  const mode = uploadStorageMode();

  if (mode === 'local') {
    return {
      backend: 'local',
      url: localUploadUrl(finalFolder, finalName),
      localPath: file.path,
      temporaryLocal: false,
    };
  }

  const client = getS3Client();
  const prefix = safeSegment(env.S3_UPLOAD_PREFIX || 'uploads', 'uploads').replace(/^\/+|\/+$/g, '');
  const month = new Date().toISOString().slice(0, 7);
  const key = [prefix, finalFolder, month, finalName].filter(Boolean).join('/');

  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  logger.info('Upload zapisany w S3/R2', { key, bucket: env.S3_BUCKET, bytes: file.size || null });
  return {
    backend: 's3',
    key,
    url: encodedPublicUrl(env.S3_PUBLIC_BASE_URL, key),
    localPath: file.path,
    temporaryLocal: true,
  };
}

async function deleteStoredUpload(stored) {
  if (!stored) return;
  if (stored.backend === 's3' && stored.key) {
    try {
      const client = getS3Client();
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: stored.key }));
    } catch (error) {
      logger.warn('upload.s3.delete', { message: error.message, key: stored.key });
    }
  }
  cleanupLocalFile(stored.localPath);
}

async function deleteUploadByUrl(url) {
  const value = String(url || '').trim();
  if (!value) return;

  const publicBase = env.S3_PUBLIC_BASE_URL ? String(env.S3_PUBLIC_BASE_URL).replace(/\/+$/, '') : '';
  if (publicBase && value.startsWith(`${publicBase}/`)) {
    const key = value
      .slice(publicBase.length + 1)
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/');
    await deleteStoredUpload({ backend: 's3', key });
    return;
  }

  if (value.startsWith('/uploads/')) {
    const rel = value.replace(/^\/uploads\/?/, '').replace(/\.\./g, '');
    cleanupLocalFile(path.join(getUploadsRoot(), rel));
  }
}

function cleanupTemporaryUpload(stored) {
  if (stored?.temporaryLocal) cleanupLocalFile(stored.localPath);
}

async function runUploadStorageSelfTest() {
  const mode = uploadStorageMode();
  const fileName = `storage_smoke_${Date.now()}_${Math.random().toString(16).slice(2)}.txt`;
  const body = Buffer.from(`arbor upload storage smoke ${new Date().toISOString()}\n`, 'utf8');

  if (mode === 'local') {
    const dir = path.join(getUploadsRoot(), 'health');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, body);
    const readBack = fs.readFileSync(filePath);
    if (!readBack.equals(body)) {
      cleanupLocalFile(filePath);
      throw new Error('Local upload storage write/read mismatch.');
    }
    cleanupLocalFile(filePath);
    return {
      ok: true,
      mode,
      backend: 'local',
      checked: 'write_read_delete',
      url: `/uploads/health/${fileName}`,
      durable: false,
      warning: 'Local upload storage is not durable on Render Free.',
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbor-upload-smoke-'));
  const tmpPath = path.join(tmpDir, fileName);
  let stored;
  try {
    fs.writeFileSync(tmpPath, body);
    stored = await persistUploadedFile(
      {
        path: tmpPath,
        filename: fileName,
        originalname: fileName,
        mimetype: 'text/plain',
        size: body.length,
      },
      { folder: 'health', fileName }
    );
    await deleteStoredUpload(stored);
    return {
      ok: true,
      mode,
      backend: stored.backend,
      checked: 'put_delete',
      key: stored.key || null,
      url: stored.url || null,
      durable: true,
    };
  } finally {
    cleanupLocalFile(tmpPath);
    try {
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  uploadStorageMode,
  persistUploadedFile,
  deleteStoredUpload,
  deleteUploadByUrl,
  cleanupLocalFile,
  cleanupTemporaryUpload,
  runUploadStorageSelfTest,
};
