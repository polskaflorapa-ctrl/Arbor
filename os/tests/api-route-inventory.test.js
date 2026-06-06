const path = require('path');
const {
  collectRouteInventory,
  formatInventory,
} = require('../scripts/api-route-inventory.cjs');

describe('API route auth inventory', () => {
  it('keeps every non-public route protected by auth middleware', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const routes = collectRouteInventory(repoRoot);
    const unprotected = routes.filter((route) => route.classification === 'unprotected');

    expect(unprotected).toEqual([]);
  });

  it('documents the expected public surfaces explicitly', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const routes = collectRouteInventory(repoRoot);
    const publicRoutes = routes.filter((route) => route.classification === 'public-allowlisted');

    expect(formatInventory(publicRoutes)).toContain('/api/auth/login');
    expect(formatInventory(publicRoutes)).toContain('/api/public/quotations/:token');
    expect(formatInventory(publicRoutes)).toContain('/track/:token');
    expect(formatInventory(publicRoutes)).toContain('/api/webhooks/kommo/task-sync');
    expect(formatInventory(publicRoutes)).toContain('/api/demo-requests');
  });
});
