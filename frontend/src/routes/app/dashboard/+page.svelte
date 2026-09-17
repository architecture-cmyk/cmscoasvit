<script>
  import { onMount } from 'svelte';
  import { countRows, getFacultyWorkload } from '$lib/data';
  import { user } from '$lib/stores';
  import { goto } from '$app/navigation';

  let stats = { faculty: 0, subjects: 0, rooms: 0, timetables: 0, published: 0, divisions: 0, load: null };
  let error = '';

  onMount(async () => {
    error = '';
    const isAdmin = $user?.role === 'admin';
    const isHod = $user?.role === 'hod';

    if (isAdmin) {
      const [f, s, r, d] = await Promise.all([
        countRows('faculty').catch(() => 0),
        countRows('subjects').catch(() => 0),
        countRows('rooms').catch(() => 0),
        countRows('divisions').catch(() => 0),
      ]);
      stats.faculty = f;
      stats.subjects = s;
      stats.rooms = r;
      stats.divisions = d;
    } else if (isHod) {
      const [f, d] = await Promise.all([
        countRows('faculty').catch(() => 0),
        countRows('divisions').catch(() => 0),
      ]);
      stats.faculty = f;
      stats.divisions = d;
    }

    const [ttTotal, ttPub] = await Promise.all([
      countRows('timetable').catch(() => 0),
      countRows('timetable', { status: 'published' }).catch(() => 0),
    ]);
    stats.timetables = ttTotal;
    stats.published = ttPub;

    if ($user?.role === 'faculty' && $user?.faculty_id) {
      try {
        stats.load = await getFacultyWorkload($user.faculty_id);
      } catch {
        stats.load = null;
      }
    }
  });

  function go(path) {
    goto(path);
  }
</script>

<h1>Dashboard</h1>
<p style="color:var(--muted)">Welcome back, <b>{$user?.email}</b> · Role: {$user?.role}</p>

{#if error}<div class="error-box">{error}</div>{/if}

<div class="grid">
  {#if $user?.role === 'admin'}
    <div class="stat"><div class="num">{stats.faculty}</div><div class="lbl">Faculty</div></div>
    <div class="stat"><div class="num">{stats.subjects}</div><div class="lbl">Subjects</div></div>
    <div class="stat"><div class="num">{stats.rooms}</div><div class="lbl">Rooms</div></div>
    <div class="stat"><div class="num">{stats.divisions}</div><div class="lbl">Divisions</div></div>
  {:else if $user?.role === 'hod'}
    <div class="stat"><div class="num">{stats.faculty}</div><div class="lbl">Faculty (dept)</div></div>
    <div class="stat"><div class="num">{stats.divisions}</div><div class="lbl">Divisions</div></div>
  {/if}
  <div class="stat"><div class="num">{stats.timetables}</div><div class="lbl">Timetables</div></div>
  <div class="stat"><div class="num">{stats.published}</div><div class="lbl">Published</div></div>
</div>

{#if $user?.role === 'faculty'}
  <div class="card" style="margin-top:18px">
    <h2>My Weekly Load</h2>
    {#if stats.load}
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div><b>{stats.load.total_hours ?? 0}h</b><div class="lbl">Total</div></div>
        <div><b>{stats.load.lecture_hours ?? '—'}</b><div class="lbl">Lecture</div></div>
        <div><b>{stats.load.tutorial_hours ?? '—'}</b><div class="lbl">Tutorial</div></div>
        <div><b>{stats.load.practical_hours ?? '—'}</b><div class="lbl">Practical</div></div>
      </div>
      {#if stats.load.overloaded}
        <div class="error-box" style="margin-top:10px">Your weekly load exceeds the maximum permitted.</div>
      {/if}
    {:else}
      <p style="color:var(--muted)">No workload computed yet for this academic year.</p>
    {/if}
  </div>
{/if}

<div class="card" style="margin-top:18px">
  <h2>Quick actions</h2>
  {#if $user?.role === 'admin'}
    <button class="btn-primary" on:click={() => go('/app/timetables')}>Generate Timetable</button>
    <button on:click={() => go('/app/faculty')}>Manage Faculty</button>
    <button on:click={() => go('/app/reports')}>Reports</button>
  {:else if $user?.role === 'hod'}
    <button class="btn-primary" on:click={() => go('/app/timetables')}>Review Timetables</button>
    <button on:click={() => go('/app/reports')}>Reports</button>
  {:else}
    <button class="btn-primary" on:click={() => go('/app/my-timetable')}>My Timetable</button>
  {/if}
</div>