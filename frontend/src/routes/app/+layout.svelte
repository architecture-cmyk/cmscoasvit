<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user, session, notify } from '$lib/stores';
  import { logout, refreshMe } from '$lib/api';
  import Toast from '$lib/components/Toast.svelte';
  import { restoreSession } from '$lib/restore';

  let ready = false;
  let nav = [];

  onMount(async () => {
    let s = $session;
    if (!s) {
      s = await restoreSession();
    }
    if (!s) {
      goto('/');
      return;
    }
    try {
      const u = await refreshMe();
      buildNav(u);
      ready = true;
    } catch (e) {
      notify(e.message, 'error');
      await logout();
      goto('/');
    }
  });

  function buildNav(u) {
    const items = [
      { href: '/app/dashboard', label: 'Dashboard', roles: ['admin', 'hod', 'faculty'] },
    ];
    if (u.role === 'admin') {
      items.push(
        { href: '/app/timetables', label: 'Timetables', roles: ['admin'] },
        { href: '/app/academic-years', label: 'Academic Years', roles: ['admin'] },
        { href: '/app/semesters', label: 'Semesters', roles: ['admin'] },
        { href: '/app/courses', label: 'Courses', roles: ['admin'] },
        { href: '/app/divisions', label: 'Divisions', roles: ['admin'] },
        { href: '/app/faculty', label: 'Faculty', roles: ['admin'] },
        { href: '/app/subjects', label: 'Subjects', roles: ['admin'] },
        { href: '/app/mappings', label: 'Mappings', roles: ['admin'] },
        { href: '/app/rooms', label: 'Rooms', roles: ['admin'] },
        { href: '/app/timing', label: 'Working Days & Slots', roles: ['admin'] },
        { href: '/app/lesson-plans', label: 'Lesson Plans', roles: ['admin'] },
        { href: '/app/attendance', label: 'Attendance', roles: ['admin'] },
        { href: '/app/reports', label: 'Reports', roles: ['admin'] },
        { href: '/app/users', label: 'Users', roles: ['admin'] }
      );
    }
    if (u.role === 'hod') {
      items.push(
        { href: '/app/timetables', label: 'Timetables', roles: ['hod'] },
        { href: '/app/lesson-plans', label: 'Lesson Plans', roles: ['hod'] },
        { href: '/app/attendance', label: 'Attendance', roles: ['hod'] },
        { href: '/app/reports', label: 'Reports', roles: ['hod'] }
      );
    }
    if (u.role === 'faculty') {
      items.push(
        { href: '/app/my-timetable', label: 'My Timetable', roles: ['faculty'] },
        { href: '/app/lesson-plans', label: 'My Lesson Plans', roles: ['faculty'] },
        { href: '/app/attendance', label: 'My Attendance', roles: ['faculty'] }
      );
    }
    nav = items.filter((i) => i.roles.includes(u.role));
  }

  $: role = $user?.role;
  $: settingsLabel = $user?.settings
    ? `AY ${$user.settings.active_academic_year_id ? '…' : '—'} / Sem ${$user.settings.active_semester_id ?? '—'}`
    : '';
</script>

{#if ready}
  <div class="shell">
    <aside>
      <div class="brand">📚 Timetable</div>
      {#if settingsLabel}<div class="context">Context: {settingsLabel}</div>{/if}
      <nav>
        {#each nav as item}
          <a href={item.href} class:active={$page.url.pathname === item.href || $page.url.pathname.startsWith(item.href + '/')}>
            {item.label}
          </a>
        {/each}
      </nav>
      <div class="user">
        <div>{$user?.email}</div>
        <div class="role-badge">{role}</div>
        <button class="btn-ghost btn-sm" on:click={async () => { await logout(); goto('/'); }}>Sign out</button>
      </div>
    </aside>
    <main>
      <slot />
    </main>
  </div>
{:else}
  <div style="padding:40px;text-align:center">Loading…</div>
{/if}

<Toast />

<style>
  .shell {
    display: grid;
    grid-template-columns: 230px 1fr;
    min-height: 100vh;
  }
  aside {
    background: #0f172a;
    color: #cbd5e1;
    padding: 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: sticky;
    top: 0;
    height: 100vh;
  }
  .brand {
    font-size: 1.1rem;
    font-weight: 700;
    color: #fff;
    padding: 0 8px;
  }
  .context {
    font-size: 11px;
    color: #94a3b8;
    padding: 0 8px;
  }
  aside nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    overflow: auto;
  }
  aside nav a {
    padding: 8px 10px;
    border-radius: 8px;
    color: #cbd5e1;
  }
  aside nav a:hover {
    background: #1e293b;
  }
  aside nav a.active {
    background: var(--primary);
    color: #fff;
  }
  .user {
    padding: 12px 8px;
    border-top: 1px solid #1e293b;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: #e2e8f0;
  }
  .role-badge {
    align-self: flex-start;
    background: #334155;
    color: #e2e8f0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    text-transform: uppercase;
  }
  main {
    padding: 26px;
    max-width: 1200px;
    width: 100%;
  }
</style>