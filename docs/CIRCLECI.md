# CircleCI

This project uses `.circleci/config.yml` as the CircleCI pipeline definition.

## Workflows

`verify` runs on normal branches and pull requests:

- `scripts`: repository script tests with `npm run verify:scripts`.
- `mobile`: mobile typecheck and lint with `npm run verify:mobile`, plus `expo-doctor`.
- `web`: Vitest tests with JUnit output, then the web production build.
- `os`: backend lint with `npm run verify:os`.
- `os-tests`: backend Jest tests with JUnit output.
- `verify-green`: final aggregate status after all verification jobs pass.

`deploy-ready` is filtered to `main` and `master` only:

- `deploy-ready`: deploy preflight, web production build, and mobile typecheck.
- `deploy-ready-green`: final deploy-preflight aggregate status.

## GitHub Branch Protection

Use `verify-green` as the required CircleCI status for pull requests.

Keep `deploy-ready-green` separate. It only runs on `main` and `master`, so requiring it on every pull request can leave feature branches waiting for a status that will never be created.

## First Run Checklist

After connecting the repository in CircleCI, check:

- The pipeline discovers `.circleci/config.yml`.
- `npm ci` succeeds with Node `22.12`.
- The `web` job uploads Vitest results under CircleCI's Tests tab.
- The `os-tests` job uploads Jest results under CircleCI's Tests tab.
- `expo-doctor` passes in the Linux CircleCI image.
- `deploy-ready` runs on `main` or `master`, but not on feature branches.

## Troubleshooting

If dependency install is slow, inspect cache restore and save timings before changing the cache strategy. The current config caches `~/.npm`, not `node_modules`, because `npm ci` deletes `node_modules` during install.

If test results do not appear, open the job artifacts and confirm that XML files exist under `test-results/vitest` or `test-results/jest`.

If `expo-doctor` is noisy or slow on every pull request, consider moving it to a separate scheduled or mainline-only job after measuring the first few runs.
