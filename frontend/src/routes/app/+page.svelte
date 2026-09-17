<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { session, user } from '$lib/stores';
  import { restoreSession } from '$lib/restore';
  import { refreshMe } from '$lib/api';

  onMount(async () => {
    let s = $session;
    if (!s) s = await restoreSession();
    if (!s) {
      goto('/');
      return;
    }
    let u = $user;
    if (!u) u = await refreshMe().catch(() => null);
    if (u?.role === 'admin') goto('/app/dashboard');
    else if (u?.role === 'hod') goto('/app/dashboard');
    else goto('/app/dashboard');
  });
</script>

<div style="padding:40px;text-align:center">Redirecting…</div>