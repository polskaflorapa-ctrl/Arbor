const http = require('http');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';

const request = (method, path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    if (payload) req.write(payload);
    req.end();
  });

const run = async () => {
  const login = await request('POST', '/api/auth/login', {
    login: 'smoke_admin',
    haslo: 'Smoke123!',
  });
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  const token = login.body.token;
  const stats = await request('GET', '/api/tasks/stats', null, { Authorization: `Bearer ${token}` });
  if (stats.status !== 200) {
    throw new Error(`Tasks stats failed: ${stats.status} ${JSON.stringify(stats.body)}`);
  }

  const me = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${token}` });
  if (me.status !== 200 || !me.body?.permissions) {
    throw new Error(`Auth me failed: ${me.status} ${JSON.stringify(me.body)}`);
  }

  const permissions = await request('GET', '/api/auth/permissions', null, { Authorization: `Bearer ${token}` });
  if (permissions.status !== 200 || !permissions.body?.permissions) {
    throw new Error(`Auth permissions failed: ${permissions.status} ${JSON.stringify(permissions.body)}`);
  }

  if (JSON.stringify(me.body.permissions) !== JSON.stringify(permissions.body.permissions)) {
    throw new Error('Permissions mismatch between /api/auth/me and /api/auth/permissions');
  }

  const payrollBlocked = await request('GET', '/api/rozliczenia/zadanie/1', null, {
    Authorization: `Bearer ${token}`,
  });
  if (payrollBlocked.status !== 403 || payrollBlocked.body?.error !== 'Podglad rozliczen wyplat jest zablokowany') {
    throw new Error(`Payroll policy mismatch: ${payrollBlocked.status} ${JSON.stringify(payrollBlocked.body)}`);
  }
  if (!payrollBlocked.body?.requestId) {
    throw new Error('Payroll block response missing requestId (/api/rozliczenia)');
  }

  const teamPayrollBlocked = await request('GET', '/api/ekipy/rozliczenie/1', null, {
    Authorization: `Bearer ${token}`,
  });
  if (teamPayrollBlocked.status !== 403 || teamPayrollBlocked.body?.error !== 'Podglad rozliczen wyplat jest zablokowany') {
    throw new Error(`Team payroll policy mismatch: ${teamPayrollBlocked.status} ${JSON.stringify(teamPayrollBlocked.body)}`);
  }
  if (!teamPayrollBlocked.body?.requestId) {
    throw new Error('Payroll block response missing requestId (/api/ekipy/rozliczenie)');
  }

  const invalid = await request(
    'PUT',
    '/api/tasks/12/status',
    { status: 'INVALID' },
    { Authorization: `Bearer ${token}` }
  );
  if (invalid.status !== 400 || invalid.body?.error !== 'Nieprawidlowe dane wejsciowe' || !invalid.body?.requestId) {
    throw new Error(`Validation contract mismatch: ${invalid.status} ${JSON.stringify(invalid.body)}`);
  }

  console.log('LOGIN_OK');
  console.log(`TASKS_STATS_STATUS=${stats.status}`);
  console.log(`AUTH_ME_STATUS=${me.status}`);
  console.log(`AUTH_PERMISSIONS_STATUS=${permissions.status}`);
  console.log('AUTH_PERMISSIONS_MATCH=true');
  console.log(`PAYROLL_BLOCK_STATUS=${payrollBlocked.status}`);
  console.log(`TEAM_PAYROLL_BLOCK_STATUS=${teamPayrollBlocked.status}`);
  console.log(`VALIDATION_STATUS=${invalid.status}`);
  console.log(`VALIDATION_ERROR=${invalid.body.error}`);
  console.log('VALIDATION_REQUEST_ID=present');
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
