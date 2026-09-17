import { verifyToken, supabase } from '../supabase.js';
import { unauthorized, forbidden } from '../utils/errors.js';

// Authenticates the Supabase access token (Authorization: Bearer <token>),
// loads the app-level role/profile row and attaches req.user.
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return next(unauthorized('Missing or malformed Authorization header'));
    }
    const token = header.slice(7).trim();
    if (!token) return next(unauthorized());

    const authUser = await verifyToken(token);

    const { data: profile, error } = await supabase
      .from('users')
      .select('id, role, department_id, faculty_id, is_active')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) throw error;
    if (!profile) {
      return next(
        forbidden('Your user account has not been provisioned with a role. Contact an administrator.')
      );
    }
    if (!profile.is_active) {
      return next(forbidden('Your user account is inactive. Contact an administrator.'));
    }

    req.user = {
      id: profile.id,
      email: authUser.email || null,
      role: profile.role,
      department_id: profile.department_id,
      faculty_id: profile.faculty_id,
    };
    req.accessToken = token;
    return next();
  } catch (err) {
    return next(err);
  }
}