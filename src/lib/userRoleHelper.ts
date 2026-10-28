import { User } from '../types';

/**
 * Checks whether a user, role value, or raw object evaluates to Admin.
 * Robustly parses:
 * - booleans (true, false)
 * - string representations ("true", "false", "1", "0")
 * - role names ("admin", "administrator", "user", "operator", "standard")
 * - numbers (1, 0)
 * Evaluates both `role` and `isAdmin` properties seamlessly.
 */
export function parseIsAdmin(userOrRole: any): boolean {
  if (userOrRole === null || userOrRole === undefined) return false;

  // Direct primitives
  if (typeof userOrRole === 'boolean') return userOrRole;
  if (typeof userOrRole === 'number') return userOrRole === 1;
  if (typeof userOrRole === 'string') {
    const s = userOrRole.trim().toLowerCase();
    if (s === 'admin' || s === 'administrator' || s === 'true' || s === '1') return true;
    if (s === 'user' || s === 'operator' || s === 'standard' || s === 'false' || s === '0') return false;
    return false;
  }

  // Object checks
  if (typeof userOrRole === 'object') {
    // 1. Check role property if present
    if ('role' in userOrRole && userOrRole.role !== undefined && userOrRole.role !== null) {
      const r = userOrRole.role;
      if (typeof r === 'boolean') return r;
      if (typeof r === 'number') return r === 1;
      if (typeof r === 'string') {
        const cleanRole = r.trim().toLowerCase();
        if (cleanRole === 'admin' || cleanRole === 'administrator' || cleanRole === 'true' || cleanRole === '1') {
          return true;
        }
        if (cleanRole === 'user' || cleanRole === 'operator' || cleanRole === 'standard' || cleanRole === 'false' || cleanRole === '0') {
          return false;
        }
      }
    }

    // 2. Check isAdmin property if present
    if ('isAdmin' in userOrRole && userOrRole.isAdmin !== undefined && userOrRole.isAdmin !== null) {
      const a = userOrRole.isAdmin;
      if (typeof a === 'boolean') return a;
      if (typeof a === 'number') return a === 1;
      if (typeof a === 'string') {
        const cleanAdmin = a.trim().toLowerCase();
        if (cleanAdmin === 'true' || cleanAdmin === '1' || cleanAdmin === 'admin') return true;
        if (cleanAdmin === 'false' || cleanAdmin === '0' || cleanAdmin === 'user') return false;
      }
    }
  }

  return false;
}

/**
 * Normalizes user record so that `isAdmin` is strictly a boolean
 * and `role` is strictly 'admin' | 'user' in complete synchronization.
 */
export function normalizeUser(rawUser: any): User {
  if (!rawUser || typeof rawUser !== 'object') return rawUser;
  const admin = parseIsAdmin(rawUser);
  return {
    ...rawUser,
    isAdmin: admin,
    role: admin ? 'admin' : 'user'
  };
}
