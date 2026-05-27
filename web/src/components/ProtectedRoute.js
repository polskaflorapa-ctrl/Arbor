/**
 * ProtectedRoute — wraps a page and enforces role / permission checks.
 *
 * Usage in App.js:
 *   <Route path="/ksiegowosc" element={
 *     <ProtectedRoute require="canViewFinance"><Ksiegowosc /></ProtectedRoute>
 *   } />
 *
 * OR by role list:
 *   <Route path="/zarzadzaj-rolami" element={
 *     <ProtectedRoute roles={['Dyrektor', 'Administrator']}><ZarzadzajRolami /></ProtectedRoute>
 *   } />
 */

import { Navigate } from 'react-router-dom';
import { readPermissions } from '../utils/permissions';
import { readStoredUser } from '../utils/readStoredUser';
import { hasAnyRole } from '../utils/roleDisplay';
import { getStoredToken } from '../utils/storedToken';

/**
 * @param {{
 *   children: React.ReactNode,
 *   require?: string,           // key of AppPermissions (e.g. 'canViewFinance')
 *   roles?: string[],           // allowed rola values (alternative to require)
 *   redirectTo?: string,        // default '/'
 * }} props
 */
export default function ProtectedRoute({ children, require: permKey, roles, redirectTo = '/' }) {
  const token = getStoredToken();
  if (!token) return <Navigate to={redirectTo} replace />;

  const user = readStoredUser();
  if (!user) return <Navigate to={redirectTo} replace />;

  // Role-list check
  if (roles && roles.length > 0) {
    if (!hasAnyRole(user.rola, roles)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Permission-flag check
  if (permKey) {
    const perms = readPermissions();
    if (!perms[permKey]) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
