const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  allowedMediaExtension,
  assertUploadedMedia,
  detectedMediaMime,
} = require('../src/services/upload-validation');

describe('upload media validation', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbor-media-validation-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function file(name, bytes, mimetype) {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, Buffer.from(bytes));
    return { path: filePath, filename: name, mimetype };
  }

  function isoBmffFile(majorBrand, mediaBox = 'mdat') {
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(ftyp.length, 0);
    ftyp.write('ftyp', 4, 'ascii');
    ftyp.write(majorBrand, 8, 'ascii');
    ftyp.writeUInt32BE(0, 12);
    ftyp.write(majorBrand, 16, 'ascii');
    ftyp.write('mp42', 20, 'ascii');
    const media = Buffer.alloc(8);
    media.writeUInt32BE(media.length, 0);
    media.write(mediaBox, 4, 'ascii');
    return Buffer.concat([ftyp, media]);
  }

  it('accepts a JPEG only when its signature matches the declared MIME', () => {
    const upload = file('photo.jpg', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg');

    expect(assertUploadedMedia(upload, { images: true })).toEqual({
      mime: 'image/jpeg',
      extension: '.jpg',
    });
    expect(detectedMediaMime(upload.path)).toBe('image/jpeg');
  });

  it('rejects active SVG content disguised as a JPEG', () => {
    const upload = file('payload.jpg', Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/jpeg');

    expect(() => assertUploadedMedia(upload, { images: true })).toThrow(/Niedozwolony typ/);
  });

  it('does not allow SVG MIME or executable extensions', () => {
    expect(allowedMediaExtension({ mimetype: 'image/svg+xml' }, { images: true })).toBeNull();
    expect(allowedMediaExtension({ mimetype: 'text/html' }, { images: true, videos: true })).toBeNull();
  });

  it('accepts an MP4 only when it has an allowed video brand and media box', () => {
    const upload = file('clip.mp4', isoBmffFile('isom'), 'video/mp4');

    expect(assertUploadedMedia(upload, { videos: true })).toEqual({
      mime: 'video/mp4',
      extension: '.mp4',
    });
  });

  it.each(['avif', 'heic', 'M4A '])('rejects non-video ISO-BMFF brand %s declared as MP4', (brand) => {
    const upload = file(`${brand.trim() || 'audio'}.mp4`, isoBmffFile(brand), 'video/mp4');

    expect(() => assertUploadedMedia(upload, { videos: true })).toThrow(/Niedozwolony typ/);
  });

  it('rejects a truncated ftyp-only header declared as MP4', () => {
    const fakeHeader = Buffer.alloc(12);
    fakeHeader.writeUInt32BE(12, 0);
    fakeHeader.write('ftyp', 4, 'ascii');
    fakeHeader.write('isom', 8, 'ascii');
    const upload = file('fake.mp4', fakeHeader, 'video/mp4');

    expect(() => assertUploadedMedia(upload, { videos: true })).toThrow(/Niedozwolony typ/);
  });
});
