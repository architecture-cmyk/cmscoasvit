<script>
  import { goto } from '$app/navigation';
  import { login } from '$lib/api';

  let email = '';
  let password = '';
  let error = '';
  let loading = false;

  async function submit() {
    error = '';
    loading = true;
    try {
      await login(email, password);
      goto('/app');
    } catch (e) {
      error = e.message || 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-wrap">
  <form class="login-card card" on:submit|preventDefault={submit}>
    <h1>📚 Education Timetable</h1>
    <p style="color:var(--muted)">Sign in with your college credentials</p>

    {#if error}<div class="error-box">{error}</div>{/if}

    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} placeholder="you@example.edu" required />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" bind:value={password} required />
    </div>
    <button class="btn-primary" type="submit" style="width:100%" disabled={loading}>
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>

<style>
  .login-wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
  }
  .login-card {
    width: 360px;
  }
</style>