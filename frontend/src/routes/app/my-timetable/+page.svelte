<script>
  import { onMount } from 'svelte';
  import { getMyTimetables } from '$lib/data';
  import { user } from '$lib/stores';
  import { goto } from '$app/navigation';
  import Table from '$lib/components/Table.svelte';

  let me = null;
  let timetables = [];
  let error = '';
  let loading = true;

  onMount(async () => {
    me = $user;
    try {
      timetables = await getMyTimetables(me?.faculty_id);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  function open(tt) {
    goto(`/app/timetables/${tt.id}`);
  }
</script>

<h1>My Timetable</h1>
{#if error}<div class="error-box">{error}</div>{/if}

{#if loading}
  <p style="color:var(--muted)">Loading…</p>
{:else}
  {#if timetables.length === 0}
    <div class="card" style="margin-top:14px">
      <p style="color:var(--muted)">No timetables assigned to you yet.</p>
    </div>
  {/if}

  {#each timetables as tt}
    <div class="card" style="margin:14px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <h2 style="margin:0">{tt.course?.name} — {tt.semester?.name}</h2>
          <span style="color:var(--muted);font-size:12px">{tt.academic_year?.name} · {tt.entry_count} sessions</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge badge-{tt.status}">{tt.status}</span>
          <button class="btn-primary btn-sm" on:click={() => open(tt)}>View</button>
        </div>
      </div>
      <Table
        columns={[
          { key: 'day', label: 'Day', render: (r) => r.time_slot?.working_day?.name || '—' },
          { key: 'period', label: 'Period', render: (r) => r.time_slot?.period_number || '—' },
          { key: 'time', label: 'Time', render: (r) => r.time_slot ? `${(r.time_slot.start_time || '').slice(0, 5)}–${(r.time_slot.end_time || '').slice(0, 5)}` : '—' },
          { key: 'subject', label: 'Subject', render: (r) => `${r.faculty?.subject?.code || ''} ${r.faculty?.subject?.name || ''}`.trim() || '—' },
          { key: 'division', label: 'Division', render: (r) => r.division?.name || '—' },
          { key: 'room', label: 'Room', render: (r) => r.room?.room_number || '—' },
          { key: 'type', label: 'Type' },
        ]}
        items={tt.entries.sort((a, b) => {
          const d = (a.time_slot?.working_day?.day_number || 0) - (b.time_slot?.working_day?.day_number || 0);
          return d !== 0 ? d : (a.time_slot?.period_number || 0) - (b.time_slot?.period_number || 0);
        })}
      />
    </div>
  {/each}
{/if}