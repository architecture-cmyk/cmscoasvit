import { createClient } from '@supabase/supabase-js';
import { env } from './config.js';

// Server-side client using the SERVICE ROLE key.
// NEVER exposed to the browser; used for authenticated, app-level-authorized writes.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export const supaUrl = env.supabaseUrl;

// Verify a browser-issued Supabase access token and return the auth user.
export async function verifyToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error('Invalid or expired access token'), { code: 'UNAUTHORIZED' });
  }
  return data.user;
}

// Supabase does not persist role claims in JWTs issued after profile changes,
// so authorization is always re-derived from the `users` table on each request.
// This means role changes take effect immediately (no stale claims).