import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RemoteResourceLimitError,
  assertPublicHttpsUrl,
  downloadPublicHttpsResource,
  isPublicNetworkAddress,
  productionSecretErrors,
  protectSensitiveStateForStorage,
  restoreSensitiveStateFromStorage,
  secretStrengthError,
} from './security.mjs';

const strong = {
  jwt: 'jwt-7P4fc10e9dB20a71xK55zM08vQ81Y2Ls',
  portal: 'portal-A11d8D1kL8vH20qS55wM9xR64nZ72cP0',
  encryption: 'encryption-Q91f2W8nK40rB66sX13pV5mT87zL20aC',
};

test('production secrets must be strong and independent', () => {
  assert.match(secretStrengthError('short', 'JWT'), /32/);
  assert.equal(secretStrengthError(strong.jwt, 'JWT'), null);

  const valid = productionSecretErrors({
    NODE_ENV: 'production',
    ARBOR_JWT_SECRET: strong.jwt,
    ARBOR_PORTAL_SECRET: strong.portal,
    ARBOR_ENCRYPTION_KEY: strong.encryption,
  });
  assert.deepEqual(valid, []);

  const duplicated = productionSecretErrors({
    NODE_ENV: 'production',
    ARBOR_JWT_SECRET: strong.jwt,
    ARBOR_PORTAL_SECRET: strong.jwt,
    ARBOR_ENCRYPTION_KEY: strong.encryption,
  });
  assert.ok(duplicated.some((message) => message.includes('muszą być różne')));
});

test('sensitive state is encrypted only in the persisted copy and round-trips', () => {
  const source = {
    communications: [{
      id: 'com-1',
      recordingUrl: 'https://recordings.example/call-1.wav',
      recordingId: 'call-1',
      transcript: [{ speaker: 'Klient', text: 'Dane osobowe' }],
      analysis: { summary: 'Poufne podsumowanie' },
    }],
    generatedDocuments: [{ id: 'doc-1', content: 'Treść umowy' }],
    employeeContracts: [{ id: 'contract-1', rate: '9800 PLN brutto' }],
  };

  const persisted = protectSensitiveStateForStorage(source);
  assert.equal(source.communications[0].recordingId, 'call-1');
  assert.match(persisted.communications[0].recordingId, /^enc:v1\./);
  assert.match(persisted.communications[0].transcript, /^enc:v1\./);
  assert.match(persisted.generatedDocuments[0].content, /^enc:v1\./);
  assert.match(persisted.employeeContracts[0].rate, /^enc:v1\./);
  assert.notEqual(JSON.stringify(persisted), JSON.stringify(source));

  const restored = restoreSensitiveStateFromStorage(persisted);
  assert.deepEqual(restored, source);
  assert.deepEqual(restoreSensitiveStateFromStorage(source), source);
});

test('SSRF guard rejects local, private, mapped and documentation addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.20',
    '198.51.100.10',
    '203.0.113.10',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ]) assert.equal(isPublicNetworkAddress(address), false, address);

  assert.equal(isPublicNetworkAddress('93.184.216.34'), true);
  assert.equal(isPublicNetworkAddress('2606:4700:4700::1111'), true);
});

test('remote URL validation requires HTTPS and public DNS answers', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(() => assertPublicHttpsUrl('http://example.com/audio.wav', { lookup: publicLookup }), /HTTPS/);
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/audio.wav', { lookup: publicLookup }), /niedozwolony/);
  await assert.rejects(
    () => assertPublicHttpsUrl('https://example.com/audio.wav', {
      lookup: async () => [{ address: '10.0.0.7', family: 4 }],
    }),
    /publiczny adres/,
  );
  const url = await assertPublicHttpsUrl('https://example.com/audio.wav', { lookup: publicLookup });
  assert.equal(url.hostname, 'example.com');
});

test('remote download enforces a hard byte limit', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const fetchImpl = async () => new Response(Buffer.from('12345'), {
    status: 200,
    headers: { 'content-type': 'audio/wav' },
  });
  const payload = await downloadPublicHttpsResource('https://example.com/audio.wav', {
    lookup,
    fetchImpl,
    maxBytes: 5,
  });
  assert.equal(payload.toString(), '12345');
  await assert.rejects(
    () => downloadPublicHttpsResource('https://example.com/audio.wav', {
      lookup,
      fetchImpl,
      maxBytes: 4,
    }),
    RemoteResourceLimitError,
  );
});
