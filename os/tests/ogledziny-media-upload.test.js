const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arbor-ogledziny-upload-'));
const previousUploadsDir = process.env.UPLOADS_DIR;
process.env.UPLOADS_DIR = uploadsRoot;

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const ogledzinyRoutes = require('../src/routes/ogledziny');
const { env } = require('../src/config/env');
const { createTestApp } = require('./helpers/create-test-app');

describe('ogledziny media upload limits', () => {
  const app = createTestApp('/api/ogledziny', ogledzinyRoutes);

  afterAll(() => {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    fs.rmSync(uploadsRoot, { recursive: true, force: true });
  });

  it('rejects more than one file and removes the partially stored upload', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Kierownik', oddzial_id: 1 },
      env.JWT_SECRET,
      { algorithm: 'HS256' },
    );
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const res = await request(app)
      .post('/api/ogledziny/1/media')
      .set('Authorization', `Bearer ${token}`)
      .attach('media', jpeg, { filename: 'first.jpg', contentType: 'image/jpeg' })
      .attach('wideo', jpeg, { filename: 'second.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_FILES');
    expect(pool.query).not.toHaveBeenCalled();

    const mediaDir = path.join(uploadsRoot, 'ogledziny');
    const remainingFiles = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
    expect(remainingFiles).toEqual([]);
  });
});
