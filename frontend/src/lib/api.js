import { supabase } from './supabaseClient';
import { session, user as userStore } from './stores';
import { get } from 'svelte/store';
import { refreshProfile } from './data';

// Auth helpers. All data access goes through $lib/data (Supabase-direct).
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  session.set(data.session);

  try {
    const profile = await refreshMe();
    return { ...data, profile };
  } catch {
    return data;
  }
}

export async function logout() {
  await supabase.auth.signOut().catch(() => {});
  session.set(null);
  userStore.set(null);
}

export async function refreshMe() {
  if (!get(session)) return null;
  const profile = await refreshProfile();
  if (profile) {
    userStore.set(profile);
    return profile;
  }
  return null;
}