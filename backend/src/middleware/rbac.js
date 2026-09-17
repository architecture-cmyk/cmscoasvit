import { forbidden } from '../utils/errors.js';

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(forbidden('Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(forbidden('You do not have permission to perform this action'));
    }
    return next();
  };
}

export const requireAdmin = requireRoles('admin');
export const requireAdminOrHod = requireRoles('admin', 'hod');
export const requireAnyUser = requireRoles('admin', 'hod', 'faculty');

// Returns a department check that must hold for HODs (admins pass).
export function departmentScopeMatches(user, departmentId) {
  if (user.role === 'admin') return true;
  if (user.role === 'hod') {
    return !!departmentId && departmentId === user.department_id;
  }
  return false;
}