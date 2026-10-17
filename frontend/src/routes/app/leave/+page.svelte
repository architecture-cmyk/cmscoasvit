<script>
  import { onMount } from 'svelte';
  import { notify } from '$lib/stores';

  const STORAGE_KEY = 'cmscoasvit.leave.proxy.demo';

  const demoFaculty = [
    { id: 'fac-1', name: 'Dr. A. B. Chavan', department: 'Computer Engineering' },
    { id: 'fac-2', name: 'Dr. X. Y. Zagade', department: 'Computer Engineering' },
    { id: 'fac-3', name: 'Prof. P. Q. Reddy', department: 'Computer Engineering' },
    { id: 'fac-4', name: 'Ms. L. M. Nair', department: 'Computer Engineering' },
  ];

  const demoTimetable = [
    { id: 'tt-1', facultyId: 'fac-1', day: 'Monday', startTime: '09:45', endTime: '10:45', subject: 'Engineering Mathematics', division: 'A' },
    { id: 'tt-2', facultyId: 'fac-1', day: 'Monday', startTime: '10:45', endTime: '11:45', subject: 'Engineering Mathematics', division: 'B' },
    { id: 'tt-3', facultyId: 'fac-2', day: 'Monday', startTime: '09:45', endTime: '10:45', subject: 'Applied Physics', division: 'A' },
    { id: 'tt-4', facultyId: 'fac-2', day: 'Tuesday', startTime: '13:30', endTime: '14:30', subject: 'Applied Physics', division: 'B' },
    { id: 'tt-5', facultyId: 'fac-3', day: 'Wednesday', startTime: '11:45', endTime: '12:45', subject: 'Programming in C', division: 'A' },
    { id: 'tt-6', facultyId: 'fac-4', day: 'Thursday', startTime: '14:30', endTime: '15:30', subject: 'Data Structures', division: 'B' },
  ];

  const demoLeaves = [
    {
      id: 'leave-1',
      facultyId: 'fac-1',
      date: '2026-10-12',
      startTime: '09:45',
      endTime: '11:45',
      reason: 'Conference leave',
      status: 'approved',
      assignments: [],
    },
  ];

  let state = { faculty: [], timetable: [], leaveRequests: [] };
  let form = {
    facultyId: '',
    date: new Date().toISOString().slice(0, 10),
    startTime: '09:45',
    endTime: '10:45',
    reason: '',
    status: 'pending',
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultState() {
    return {
      faculty: clone(demoFaculty),
      timetable: clone(demoTimetable),
      leaveRequests: clone(demoLeaves),
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = parsed && Array.isArray(parsed.leaveRequests) ? parsed : defaultState();
      } else {
        state = defaultState();
      }
    } catch (err) {
      state = defaultState();
    }
    if (!state.faculty.length) state.faculty = clone(demoFaculty);
    if (!state.timetable.length) state.timetable = clone(demoTimetable);
    if (!state.leaveRequests.length) state.leaveRequests = clone(demoLeaves);
    refreshAssignments();
    saveState();
  }

  function toMinutes(time) {
    if (!time) return 0;
    const [hours, minutes] = String(time).split(':').map(Number);
    return hours * 60 + minutes;
  }

  function overlaps(startA, endA, startB, endB) {
    return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
  }

  function dayName(dateString) {
    const d = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  }

  function getFacultyName(facultyId) {
    const faculty = state.faculty.find((item) => item.id === facultyId);
    return faculty ? faculty.name : 'Unknown faculty';
  }

  function getFacultyProxyCount(facultyId) {
    return state.leaveRequests.reduce((count, leave) => {
      const assigned = (leave.assignments || []).filter((entry) => entry.proxyFacultyId === facultyId).length;
      return count + assigned;
    }, 0);
  }

  function buildAssignmentsForLeave(leave, otherLeaves = []) {
    const assignments = [];
    const leaveDay = dayName(leave.date);
    const affectedEntries = state.timetable.filter((entry) => {
      return entry.facultyId === leave.facultyId && entry.day === leaveDay && overlaps(entry.startTime, entry.endTime, leave.startTime, leave.endTime);
    });

    for (const entry of affectedEntries) {
      const sameSlotAssignments = otherLeaves.flatMap((other) => other.assignments || []).filter((assignment) => assignment.entryId === entry.id);
      const onLeaveFaculty = otherLeaves.some((other) => {
        if (other.id === leave.id || other.status !== 'approved') return false;
        return other.facultyId === leave.facultyId && other.date === leave.date && overlaps(other.startTime, other.endTime, entry.startTime, entry.endTime);
      });

      const candidates = state.faculty.filter((faculty) => {
        if (faculty.id === leave.facultyId) return false;
        const clashWithOwnClass = state.timetable.some((slot) => {
          return slot.facultyId === faculty.id && slot.day === leaveDay && slot.id !== entry.id && overlaps(slot.startTime, slot.endTime, entry.startTime, entry.endTime);
        });
        if (clashWithOwnClass) return false;

        const alreadyAssigned = sameSlotAssignments.some((assignment) => assignment.proxyFacultyId === faculty.id);
        if (alreadyAssigned) return false;

        const underLeave = otherLeaves.some((other) => {
          if (other.status !== 'approved') return false;
          return other.facultyId === faculty.id && other.date === leave.date && overlaps(other.startTime, other.endTime, entry.startTime, entry.endTime);
        });
        if (underLeave) return false;

        return true;
      }).sort((a, b) => getFacultyProxyCount(a.id) - getFacultyProxyCount(b.id));

      const proxyFaculty = candidates[0] || null;
      assignments.push({
        entryId: entry.id,
        entryLabel: `${entry.subject} • ${entry.day} • ${entry.startTime} - ${entry.endTime}`,
        proxyFacultyId: proxyFaculty ? proxyFaculty.id : null,
        proxyFacultyName: proxyFaculty ? proxyFaculty.name : 'Unassigned',
        status: proxyFaculty ? 'Assigned' : 'Unassigned',
        couldBeOnLeave: onLeaveFaculty,
      });
    }

    return assignments;
  }

  function refreshAssignments() {
    state.leaveRequests = state.leaveRequests.map((leave) => {
      const otherLeaves = state.leaveRequests.filter((item) => item.id !== leave.id);
      const assignments = buildAssignmentsForLeave(leave, otherLeaves);
      return { ...leave, assignments };
    });
  }

  function resetForm() {
    form = {
      facultyId: state.faculty[0]?.id || '',
      date: new Date().toISOString().slice(0, 10),
      startTime: '09:45',
      endTime: '10:45',
      reason: '',
      status: 'pending',
    };
  }

  function submitLeave() {
    if (!form.facultyId || !form.date || !form.startTime || !form.endTime || !form.reason.trim()) {
      notify('Please fill in all leave fields.', 'error');
      return;
    }

    const leave = {
      id: `leave-${Date.now()}`,
      facultyId: form.facultyId,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      reason: form.reason.trim(),
      status: form.status,
      assignments: [],
    };

    state.leaveRequests = [leave, ...state.leaveRequests];
    refreshAssignments();
    saveState();
    resetForm();
    notify('Leave request saved.', 'success');
  }

  function updateStatus(leaveId, status) {
    state.leaveRequests = state.leaveRequests.map((leave) => {
      if (leave.id === leaveId) return { ...leave, status };
      return leave;
    });
    refreshAssignments();
    saveState();
    notify(`Leave marked as ${status}.`, 'success');
  }

  function clearDemoData() {
    state = defaultState();
    saveState();
    notify('Demo data restored.', 'success');
  }

  onMount(() => {
    loadState();
    resetForm();
  });

  $: totalAssignments = state.leaveRequests.reduce((count, leave) => count + (leave.assignments || []).length, 0);
  $: assignedCount = state.leaveRequests.reduce((count, leave) => count + (leave.assignments || []).filter((item) => item.proxyFacultyId).length, 0);
  $: unassignedCount = totalAssignments - assignedCount;
</script>

<h1>Leave & Proxy Management</h1>
<p style="color: var(--muted); margin-top: 0;">Automatic staff allocation for timetable conflicts and leave coverage.</p>

<div class="stats-grid">
  <div class="stat-card">
    <span class="label">Leave requests</span>
    <strong>{state.leaveRequests.length}</strong>
  </div>
  <div class="stat-card">
    <span class="label">Assigned</span>
    <strong>{assignedCount}</strong>
  </div>
  <div class="stat-card">
    <span class="label">Unassigned</span>
    <strong>{unassignedCount}</strong>
  </div>
</div>

<div class="card section">
  <h2>New leave request</h2>
  <form class="form-grid" on:submit|preventDefault={submitLeave}>
    <div class="field">
      <label for="leave-faculty">Faculty</label>
      <select id="leave-faculty" bind:value={form.facultyId}>
        <option value="">Select faculty</option>
        {#each state.faculty as faculty}
          <option value={faculty.id}>{faculty.name}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="leave-date">Date</label>
      <input id="leave-date" type="date" bind:value={form.date} />
    </div>

    <div class="field">
      <label for="leave-start">Start time</label>
      <input id="leave-start" type="time" bind:value={form.startTime} />
    </div>

    <div class="field">
      <label for="leave-end">End time</label>
      <input id="leave-end" type="time" bind:value={form.endTime} />
    </div>

    <div class="field wide">
      <label for="leave-reason">Reason</label>
      <input id="leave-reason" type="text" bind:value={form.reason} placeholder="Conference, medical leave, duty assignment..." />
    </div>

    <div class="field">
      <label for="leave-status">Status</label>
      <select id="leave-status" bind:value={form.status}>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>

    <div class="actions">
      <button type="submit" class="btn-primary">Add leave request</button>
      <button type="button" class="btn-ghost" on:click={clearDemoData}>Reset demo</button>
    </div>
  </form>
</div>

<div class="card section">
  <h2>Proxy allocation</h2>
  {#if state.leaveRequests.length === 0}
    <p class="muted">No leave requests yet.</p>
  {:else}
    {#each state.leaveRequests as leave}
      <div class="leave-item">
        <div class="leave-header">
          <div>
            <h3>{getFacultyName(leave.facultyId)}</h3>
            <p>{leave.date} • {leave.startTime} - {leave.endTime} • {leave.reason}</p>
          </div>
          <div class="status-row">
            <span class={`badge ${leave.status}`}>{leave.status}</span>
            <button class="btn-ghost btn-sm" type="button" on:click={() => updateStatus(leave.id, 'pending')}>Pending</button>
            <button class="btn-ghost btn-sm" type="button" on:click={() => updateStatus(leave.id, 'approved')}>Approve</button>
            <button class="btn-ghost btn-sm" type="button" on:click={() => updateStatus(leave.id, 'rejected')}>Reject</button>
          </div>
        </div>

        {#if (leave.assignments || []).length === 0}
          <p class="muted">No timetable conflicts found for this leave period.</p>
        {:else}
          <div class="assignment-list">
            {#each leave.assignments as assignment}
              <div class="assignment-row">
                <span class="assignment-name">{assignment.entryLabel}</span>
                <span class={`badge ${assignment.status.toLowerCase()}`}>{assignment.status}</span>
                <span class="proxy-name">{assignment.proxyFacultyName}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;
    margin: 18px 0 20px;
  }

  .stat-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.04);
  }

  .label {
    color: var(--muted, #64748b);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .stat-card strong {
    font-size: 1.8rem;
  }

  .section {
    margin-bottom: 20px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field.wide {
    grid-column: 1 / -1;
  }

  .actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 4px;
  }

  .leave-item {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px;
    background: #f8fafc;
    margin-top: 12px;
  }

  .leave-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
  }

  .leave-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .leave-header p {
    margin: 6px 0 0;
    color: var(--muted, #64748b);
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .badge.pending {
    background: #fef3c7;
    color: #92400e;
  }

  .badge.approved {
    background: #dcfce7;
    color: #166534;
  }

  .badge.rejected {
    background: #fee2e2;
    color: #991b1b;
  }

  .badge.assigned {
    background: #dbeafe;
    color: #1d4ed8;
  }

  .badge.unassigned {
    background: #f1f5f9;
    color: #475569;
  }

  .assignment-list {
    margin-top: 12px;
    display: grid;
    gap: 10px;
  }

  .assignment-row {
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) auto auto;
    gap: 12px;
    align-items: center;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 12px;
  }

  .assignment-name {
    font-weight: 600;
  }

  .proxy-name {
    color: var(--muted, #64748b);
    font-size: 0.95rem;
  }

  .muted {
    color: var(--muted, #64748b);
  }

  @media (max-width: 720px) {
    .leave-header {
      display: block;
    }

    .assignment-row {
      grid-template-columns: 1fr;
    }
  }
</style>
