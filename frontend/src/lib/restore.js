import { supabase } from './supabaseClient';
import { session } from './stores';

// Restore an existing Supabase session on app start.
export async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    session.set(null);
    return null;
  }

  if (data.session) {
    session.set(data.session);
  } else {
    session.set(null);
  }

  return data.session;
}