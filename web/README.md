# ARBOR Web

React frontend for ARBOR-OS, built with Vite.

## Scripts

Run from the repository root with `-w arbor-web`, or from this `web` directory without the workspace flag.

- `npm start` - starts the Vite dev server. By default it uses port `3002` and proxies `/api` to `http://localhost:3001`.
- `npm test` - runs Vitest once.
- `npm run test:watch` - runs Vitest in watch mode.
- `npm run build` - builds production assets into `web/build`.
- `npm run preview` - builds and serves the production bundle locally.

## Environment

Use `VITE_API_URL=/api` for same-origin deployments. For a remote backend, set `VITE_API_URL=https://<api-host>/api` or `VITE_API_URL=https://<api-host>`.

The Vite config still maps legacy `REACT_APP_*` variables for compatibility with older deploy environments.
