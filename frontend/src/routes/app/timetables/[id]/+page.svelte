<script>
  import { onMount } from 'svelte';
  import { getTimetable, listTimetableEntries, transitionTimetable, deleteTimetable, validateTimetable, exportTimetablePdf, exportTimetableExcel } from '$lib/data';
  import { user, notify } from '$lib/stores';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Table from '$lib/components/Table.svelte';

  let tt = null;
  let entries = [];
  let error = '';
  let busy = false;
  let conflicts = [];

  const id = $page.params.id;

  async function load() {
    error = '';
    try {
      const [a, b] = await Promise.all([getTimetable(id), listTimetableEntries(id)]);
      tt = a;
      entries = b;
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);

  $: days = [...new Set(entries.map((e) => e.time_slot?.working_day?.name).filter(Boolean))];
  $: periods = [...new Set(entries.map((e) => e.time_slot?.period_number).filter((x) => x != null))].sort((a, b) => a - b);
  $: me = $user;

  function cell(day, p) {
    return entries.find((e) => e.time_slot?.working_day?.name === day && e.time_slot?.period_number === p);
  }

  async function act(path, extra = {}) {
    busy = true;
    error = '';
    conflicts = [];
    try {
      await transitionTimetable(id, path, extra.comment);
      notify(`Timetable ${path.replace('-', ' ')}`, 'success');
      await load();
    } catch (e) {
      error = e.message;
      if (e.conflicts?.length) conflicts = e.conflicts;
    } finally {
      busy = false;
    }
  }

  async function validate() {
    busy = true;
    error = '';
    conflicts = [];
    try {
      const result = await validateTimetable(id);
      if (result.valid) {
        notify('Timetable is valid', 'success');
      } else {
        conflicts = result.conflicts;
        notify('Conflicts found', 'error');
      }
    } catch (e) {
      error = e.message;
      if (e.conflicts?.length) conflicts = e.conflicts;
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!confirm('Delete this timetable? Its entries will be removed.')) return;
    try {
      await deleteTimetable(id);
      notify('Timetable deleted', 'success');
      goto('/app/timetables');
    } catch (e) {
      error = e.message;
    }
  }

  async function download(kind) {
    try {
      error = '';
      if (kind === 'pdf') await exportTimetablePdf(id);
      else await exportTimetableExcel(id);
    } catch (e) {
      error = e.message;
    }
  }

  function rejectHod() {
    const comment = prompt('Rejection comment (required):');
    if (!comment || !comment.trim()) return;
    act('reject', { comment: comment.trim() });
  }
</script>

{#if error && !tt}
  <div class="error-box">{error}</div>
{:else if !tt}
  <p>Loading…</p>
{:else}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
    <div>
      <h1>Timetable · {tt.course?.name}</h1>
      <p style="color:var(--muted)">
        {tt.academic_year?.name} · {tt.semester?.name}
        <span class="badge badge-{tt.status}">{tt.status}</span>
        · {tt.entry_count ?? entries.length} entries
      </p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm" on:click={() => download('excel')} disabled={busy}>Excel</button>
      <button class="btn-sm" on:click={() => download('pdf')} disabled={busy}>PDF</button>
      {#if ['admin', 'hod'].includes(me?.role)}
        <button class="btn-sm" on:click={validate} disabled={busy}>Validate</button>
      {/if}
      {#if me?.role === 'admin'}
        {#if tt.status === 'draft'}
          <button class="btn-sm btn-primary" on:click={() => act('submit')} disabled={busy}>Submit for approval</button>
        {/if}
        {#if tt.status === 'approved'}
          <button class="btn-sm btn-success" on:click={() => act('publish')} disabled={busy}>Publish</button>
          <button class="btn-sm" on:click={() => act('archive')} disabled={busy}>Archive</button>
        {/if}
        {#if tt.status === 'pending_approval'}
          <button class="btn-sm btn-success" on:click={() => act('approve')} disabled={busy}>Approve</button>
          <button class="btn-sm btn-danger" on:click={rejectHod} disabled={busy}>Reject</button>
        {/if}
        {#if tt.status === 'published'}
          <button class="btn-sm" on:click={() => act('unpublish')} disabled={busy}>Unpublish</button>
          <button class="btn-sm" on:click={() => act('unpublish-archive')} disabled={busy}>Unpublish &amp; archive</button>
        {/if}
        {#if tt.status !== 'published'}
          <button class="btn-sm btn-danger" on:click={remove} disabled={busy}>Delete</button>
        {/if}
      {/if}
      {#if me?.role === 'hod'}
        {#if tt.status === 'pending_approval'}
          <button class="btn-sm btn-success" on:click={() => act('approve')} disabled={busy}>Approve</button>
          <button class="btn-sm btn-danger" on:click={rejectHod} disabled={busy}>Reject</button>
        {/if}
      {/if}
    </div>
  </div>

  {#if error}
    <div class="error-box">{error}</div>
  {/if}

  {#if conflicts.length}
    <div class="error-box">Conflicts:<br />{conflicts.map((c) => `• ${c.detail || c.message || JSON.stringify(c)}`).join('\n')}</div>
  {/if}

  <div class="card" style="margin-top:16px;overflow:auto">
    <table class="data">
      <thead>
        <tr>
          <th>Day / Period</th>
          {#each periods as p}<th>P{p}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each days as day}
          <tr>
            <td><b>{day}</b></td>
            {#each periods as p}
              {@const e = cell(day, p)}
              <td>
                {#if e}
                  <div><b>{e.faculty?.subject?.code}</b> {e.faculty?.subject?.name}</div>
                  <div>{e.faculty?.faculty?.name}</div>
                  <div>{e.room?.room_number} · {e.session_type}</div>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>All entries</h2>
    <Table
      columns={[
        { key: 'division', label: 'Division', render: (e) => e.division?.name },
        { key: 'subject', label: 'Subject', render: (e) => `${e.faculty?.subject?.code}` },
        { key: 'faculty', label: 'Faculty', render: (e) => e.faculty?.faculty?.name },
        { key: 'room', label: 'Room', render: (e) => `${e.room?.room_number} (${e.room?.room_type})` },
        { key: 'time', label: 'Day / Period', render: (e) => `${e.time_slot?.working_day?.name} P${e.time_slot?.period_number} ${e.time_slot?.start_time}-${e.time_slot?.end_time}` },
        { key: 'session_type', label: 'Type', render: (e) => e.session_type },
        { key: 'is_break', label: 'Break', render: (e) => e.time_slot?.is_break ? 'Yes' : '—' },
      ]}
      items={entries}
      empty="No entries. Generate or re-generate this timetable."
    />
  </div>
{/if}