const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const ORIGINAL_ENV = { ...process.env };

describe('static uploads access policy', () => {
  let uploadRoot;

  beforeEach(() => {
    jest.resetModules();
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arbor-uploads-test-'));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      UPLOADS_DIR: uploadRoot,
      PUBLIC_UPLOADS_BLOCK_PRIVATE: 'true',
    };
  });

  afterEach(() => {
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('blocks private task upload folders from public static serving', async () => {
    const privateDir = path.join(uploadRoot, 'task-documents');
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'secret.pdf'), '%PDF-1.4\nsecret\n');

    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app).get('/uploads/task-documents/secret.pdf');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HTTP_NOT_FOUND');
  });

  it('continues serving non-private upload folders', async () => {
    const publicDir = path.join(uploadRoot, 'health');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'ok.txt'), 'ok');

    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app).get('/uploads/health/ok.txt');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});
