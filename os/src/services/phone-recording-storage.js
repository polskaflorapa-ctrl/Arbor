const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../config/logger');
const { env } = require('../config/env');

/** Katalog poza publicznym `uploads/` — nie serwowany jako static. */
const localArchiveRoot = () => {
  if (env.PHONE_RECORDINGS_DIR && String(env.PHONE_RECORDINGS_DIR).trim()) {
    return path.resolve(String(env.PHONE_RECORDINGS_DIR).trim());
  }
  return path.join(__dirname, '..', '..', 'private', 'phone-recordings');
};

const pickExtension = (contentType) => {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('ogg')) return 'ogg';
  return 'mp3';
};

const storageMode = () => {
  const m = (env.PHONE_RECORDING_STORAGE || 'local').toLowerCase();
  if (['none', 'local', 's3', 'gdrive'].includes(m)) return m;
  return 'local';
};

function ensureS3Client() {
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Brak S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
  }
  const region = env.S3_REGION || 'auto';
  const endpoint = env.S3_ENDPOINT ? String(env.S3_ENDPOINT).trim() : undefined;
  const forcePathStyle =
    env.S3_FORCE_PATH_STYLE === true ||
    env.S3_FORCE_PATH_STYLE === 'true' ||
    (endpoint && endpoint.includes('r2.cloudflarestorage.com'));
  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: !!forcePathStyle,
  });
}

/**
 * Zapisuje nagranie od razu po pobraniu z Twilio.
 * @returns {{ backend: string, ref: string, url: string | null } | null}
 */
async function persistPhoneRecording({ buffer, contentType, callSid, recordingSid }) {
  const mode = storageMode();
  if (mode === 'none' || !buffer?.length) return null;

  const safeRec = String(recordingSid || 'rec').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeCall = String(callSid || 'call').replace(/[^a-zA-Z0-9_-]/g, '');
  const ext = pickExtension(contentType);
  const ym = new Date().toISOString().slice(0, 7);

  if (mode === 'local') {
    const root = localArchiveRoot();
    fs.mkdirSync(root, { recursive: true });
    const rel = path.join(ym, `${safeCall}_${safeRec}.${ext}`).replace(/\\/g, '/');
    const full = path.join(root, ym);
    fs.mkdirSync(full, { recursive: true });
    const dest = path.join(root, rel);
    fs.writeFileSync(dest, buffer);
    logger.info('Nagranie zapisane lokalnie', { rel, bytes: buffer.length });
    return { backend: 'local', ref: rel, url: null };
  }

  if (mode === 's3') {
    const client = ensureS3Client();
    const key = `phone-recordings/${ym}/${safeCall}_${safeRec}.${ext}`;
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'audio/mpeg',
      })
    );
    const publicBase = env.S3_PUBLIC_BASE_URL ? String(env.S3_PUBLIC_BASE_URL).replace(/\/$/, '') : '';
    const url = publicBase ? `${publicBase}/${encodeURI(key)}` : null;
    logger.info('Nagranie zapisane w S3', { key, bucket: env.S3_BUCKET });
    return { backend: 's3', ref: key, url };
  }

  if (mode === 'gdrive') {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error('Brak GOOGLE_SERVICE_ACCOUNT_JSON lub GOOGLE_DRIVE_FOLDER_ID');
    }
    let creds;
    try {
      creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nie jest poprawnym JSON');
    }
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const fileName = `${safeCall}_${safeRec}.${ext}`;
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [String(env.GOOGLE_DRIVE_FOLDER_ID).trim()],
      },
      media: {
        mimeType: contentType || 'audio/mpeg',
        body: Readable.from(buffer),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    const id = res.data.id;
    const webViewLink = res.data.webViewLink || `https://drive.google.com/file/d/${id}/view`;
    logger.info('Nagranie zapisane w Google Drive', { id });
    return { backend: 'gdrive', ref: id, url: webViewLink };
  }

  return null;
}

function resolveLocalRecordingPath(relRef) {
  if (!relRef || typeof relRef !== 'string') return null;
  const normalized = relRef.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  return path.join(localArchiveRoot(), normalized);
}

async function getPresignedS3DownloadUrl(objectKey, expiresSec = 3600) {
  const client = ensureS3Client();
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey });
  return getSignedUrl(client, cmd, { expiresIn: expiresSec });
}

/**
 * Wysyła nagranie do klienta HTTP (plik lokalny, presigned S3 lub redirect Drive).
 * @returns {boolean} czy obsłużono
 */
async function sendRecordingToHttpResponse(row, res) {
  const backend = row.recording_archive_backend;
  const ref = row.recording_archive_ref;
  if (!backend || !ref) return false;

  if (backend === 'local') {
    const p = resolveLocalRecordingPath(ref);
    if (!p || !fs.existsSync(p)) return false;
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime =
      ext === 'wav'
        ? 'audio/wav'
        : ext === 'webm'
          ? 'audio/webm'
          : ext === 'ogg'
            ? 'audio/ogg'
            : ext === 'mp3'
              ? 'audio/mpeg'
              : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    fs.createReadStream(p)
      .on('error', () => {
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);
    return true;
  }

  if (backend === 's3') {
    try {
      const url = await getPresignedS3DownloadUrl(ref);
      return res.redirect(302, url);
    } catch (e) {
      logger.error('S3 presign nagrania', { message: e.message });
      return false;
    }
  }

  if (backend === 'gdrive') {
    const u = row.recording_archive_url;
    if (u) return res.redirect(302, u);
    const fallback = `https://drive.google.com/file/d/${ref}/view`;
    return res.redirect(302, fallback);
  }

  return false;
}

module.exports = {
  persistPhoneRecording,
  resolveLocalRecordingPath,
  getPresignedS3DownloadUrl,
  sendRecordingToHttpResponse,
  localArchiveRoot,
};
