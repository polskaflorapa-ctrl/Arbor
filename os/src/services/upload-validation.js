const fs = require('fs');

const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const VIDEO_MIME_EXTENSIONS = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
]);

// Wyłącznie marki kontenerów wideo, które obsługujemy jako MP4. Sam znacznik
// `ftyp` występuje też w AVIF/HEIC/M4A, więc nie może być wystarczającym dowodem.
const MP4_MAJOR_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'F4V ',
  'dash', 'cmfc', 'cmfs', 'msdh', 'msix', 'MSNV',
]);
const ISO_BMFF_MEDIA_BOXES = new Set(['mdat', 'moov', 'moof']);

function normalizedMime(file) {
  return String(file?.mimetype || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function allowedMediaExtension(file, { images = true, videos = false } = {}) {
  const mime = normalizedMime(file);
  if (images && IMAGE_MIME_EXTENSIONS.has(mime)) return IMAGE_MIME_EXTENSIONS.get(mime);
  if (videos && VIDEO_MIME_EXTENSIONS.has(mime)) return VIDEO_MIME_EXTENSIONS.get(mime);
  return null;
}

function unsupportedMediaError() {
  const error = new Error('Niedozwolony typ pliku multimedialnego.');
  error.status = 415;
  error.apiCode = 'UNSUPPORTED_MEDIA_TYPE';
  return error;
}

function mediaFileFilter(options) {
  return (_req, file, callback) => {
    if (allowedMediaExtension(file, options)) return callback(null, true);
    return callback(unsupportedMediaError(), false);
  };
}

function detectIsoBmffVideoMime(fd, fileSize, head) {
  if (head.length < 16 || head.subarray(4, 8).toString('ascii') !== 'ftyp') return null;

  const ftypSize = head.readUInt32BE(0);
  if (ftypSize < 16 || ftypSize > fileSize || (ftypSize - 16) % 4 !== 0) return null;

  const majorBrand = head.subarray(8, 12).toString('ascii');
  const mime = majorBrand === 'qt  '
    ? 'video/quicktime'
    : MP4_MAJOR_BRANDS.has(majorBrand)
      ? 'video/mp4'
      : null;
  if (!mime) return null;

  // Przechodzimy po nagłówkach pudełek bez wczytywania filmu do pamięci.
  // Prawidłowy kontener musi zawierać co najmniej dane lub strukturę filmu.
  let offset = 0;
  let inspectedBoxes = 0;
  while (offset + 8 <= fileSize && inspectedBoxes < 10000) {
    const header = Buffer.alloc(16);
    const bytes = fs.readSync(fd, header, 0, header.length, offset);
    if (bytes < 8) return null;

    let boxSize = header.readUInt32BE(0);
    const boxType = header.subarray(4, 8).toString('ascii');
    let headerSize = 8;
    if (boxSize === 1) {
      if (bytes < 16) return null;
      const extendedSize = header.readBigUInt64BE(8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      boxSize = Number(extendedSize);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = fileSize - offset;
    }

    if (boxSize < headerSize || offset + boxSize > fileSize) return null;
    if (ISO_BMFF_MEDIA_BOXES.has(boxType)) return mime;
    offset += boxSize;
    inspectedBoxes += 1;
  }
  return null;
}

function detectedMediaMime(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(32);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytes);

    if (head.length >= 3 && head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return 'image/jpeg';
    }
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp';
    }
    if (head.length >= 6 && ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString('ascii'))) {
      return 'image/gif';
    }
    const isoBmffMime = detectIsoBmffVideoMime(fd, fileSize, head);
    if (isoBmffMime) return isoBmffMime;
    if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return 'video/webm';
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function assertUploadedMedia(file, options) {
  if (!file?.path) throw unsupportedMediaError();
  const declaredMime = normalizedMime(file);
  const detectedMime = detectedMediaMime(file.path);
  const expectedExtension = allowedMediaExtension(file, options);
  if (!expectedExtension || detectedMime !== declaredMime) throw unsupportedMediaError();
  return { mime: detectedMime, extension: expectedExtension };
}

module.exports = {
  allowedMediaExtension,
  assertUploadedMedia,
  detectedMediaMime,
  mediaFileFilter,
  normalizedMime,
};
