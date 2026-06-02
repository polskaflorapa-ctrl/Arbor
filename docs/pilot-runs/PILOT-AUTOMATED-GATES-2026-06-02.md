# Pilot automated gates - 2026-06-02

Mode: core
Continue on fail: yes

| Gate | Result | Exit | Duration ms |
| --- | --- | --- | --- |
| `npm run status:json:strict` | PASS | 0 | 845 |
| `npm run verify:pilot-closure` | PASS | 0 | 785 |
| `npm run verify:pilot-execution` | PASS | 0 | 596 |
| `npm run verify:pilot-hardening` | PASS | 0 | 606 |
| `npm run verify:rbac-scope` | PASS | 0 | 630 |
| `npm run verify:kommo-idempotency-retry` | PASS | 0 | 736 |
| `npm run verify:kommo-sms-drill` | PASS | 0 | 1027 |
| `npm run verify:backup-rpo` | PASS | 0 | 1033 |
| `npm run verify:observability` | PASS | 0 | 935 |
| `npm run verify:web-tti` | PASS | 0 | 891 |
| `npm run smoke:critical-path` | PASS | 0 | 9154 |

## Logs

### PASS - npm run status:json:strict

```text
> status:json:strict
> node ./scripts/status.cjs --json --strict

{
  "healthy": true,
  "proxyTarget": "http://localhost:3001",
  "ports": {
    "web3000": true,
    "web3002": true,
    "api3001": true
  },
  "apiHealth": {
    "ok": true,
    "status": 200,
    "note": "unknown-service"
  },
  "suggestions": [
    "npm run dev:os (optional)"
  ]
}
```

### PASS - npm run verify:pilot-closure

```text
> verify:pilot-closure
> node ./scripts/pilot-closure-check.cjs

pilot closure go-live gate check passed
```

### PASS - npm run verify:pilot-execution

```text
> verify:pilot-execution
> node ./scripts/pilot-execution-check.cjs

pilot execution evidence template check passed
```

### PASS - npm run verify:pilot-hardening

```text
> verify:pilot-hardening
> node ./scripts/pilot-hardening-check.cjs

[pilot-hardening-check] OK (6 files, 4 package files)
```

### PASS - npm run verify:rbac-scope

```text
> verify:rbac-scope
> node ./scripts/rbac-scope-check.cjs

[rbac-scope-check] OK (14 files, 1 package files)
```

### PASS - npm run verify:kommo-idempotency-retry

```text
> verify:kommo-idempotency-retry
> node ./scripts/kommo-idempotency-retry-check.cjs

Kommo idempotency/retry/dead-letter contract check passed
```

### PASS - npm run verify:kommo-sms-drill

```text
> verify:kommo-sms-drill
> node ./scripts/kommo-sms-drill-check.cjs

[kommo-sms-drill-check] OK (12 files, 1 package files)
```

### PASS - npm run verify:backup-rpo

```text
> verify:backup-rpo
> node ./scripts/backup-rpo-check.cjs

[backup-rpo-check] OK (7 files, 2 package files)
```

### PASS - npm run verify:observability

```text
> verify:observability
> node ./scripts/observability-check.cjs

[observability-check] OK (11 files, 2 package files)
```

### PASS - npm run verify:web-tti

```text
> verify:web-tti
> node ./scripts/web-tti-check.cjs

[web-tti-check] OK (6 files, 2 package files)
```

### PASS - npm run smoke:critical-path

```text
> smoke:critical-path
> npm run test:critical-path -w arbor-os


> arbor-os@1.0.0 test:critical-path
> jest --runInBand tests/critical-path-smoke.test.js

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        6.002 s, estimated 7 s
Ran all test suites matching tests/critical-path-smoke.test.js.
```

