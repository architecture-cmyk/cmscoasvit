import { writable } from 'svelte/store';

// The `session` store holds the active Supabase session.
export const session = writable(null);

// The `user` store holds the current user profile, preferring the
// Supabase-backed role data and falling back to the backend profile payload.
export const user = writable(null);

export const toast = writable(null);

let toastTimer;
export function notify(message, type = 'info') {
  toast.set({ message, type });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), 4000);
}