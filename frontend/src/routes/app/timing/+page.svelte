<script>
  import { onMount } from 'svelte';
  import {
    listWorkingDays,
    createWorkingDay,
    updateWorkingDay,
    deleteWorkingDay,
    listTimeSlots,
    createTimeSlot,
    updateTimeSlot,
    deleteTimeSlot,
    importRows,
    excelVal,
    excelBool,
  } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let days = [];
  let slots = [];
  let error = '';
  let dayForm = { name: '', day_number: 1, is_active: true };
  let dayEditing = null;
  let slotForm = { working_day_id: '', period_number: 1, start_time: '09:00', end_time: '10:00', is_break: false, is_active: true };
  let slotEditing = null;

  async function load() {
    [days, slots] = await Promise.all([listWorkingDays(), listTimeSlots()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  // ---- Working days ----
  function resetDayForm() {
    dayForm = { name: '', day_number: 1, is_active: true };
    dayEditing = null;
  }

  function startEditDay(item) {
    dayEditing = item;
    dayForm = { name: item.name, day_number: item.day_number, is_active: item.is_active };
  }

  async function saveDay(e) {
    e.preventDefault();
    error = '';
    try {
      const body = { name: dayForm.name, day_number: Number(dayForm.day_number), is_active: dayForm.is_active };
      if (dayEditing) {
        await updateWorkingDay(dayEditing.id, body);
        notify('Updated', 'success');
      } else {
        await createWorkingDay(body);
        notify('Created', 'success');
      }
      resetDayForm();
      await load();
    } catch (err) { error = err.message; }
  }

  async function removeDay(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteWorkingDay(item.id);
      notify(r?.deactivated ? 'Has slots — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  // ---- Time slots ----
  function resetSlotForm() {
    slotForm = { working_day_id: '', period_number: 1, start_time: '09:00', end_time: '10:00', is_break: false, is_active: true };
    slotEditing = null;
  }

  function startEditSlot(item) {
    slotEditing = item;
    slotForm = {
      working_day_id: item.working_day_id || '',
      period_number: item.period_number,
      start_time: (item.start_time || '').slice(0, 5),
      end_time: (item.end_time || '').slice(0, 5),
      is_break: item.is_break,
      is_active: item.is_active,
    };
  }

  async function saveSlot(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        working_day_id: slotForm.working_day_id || null,
        period_number: Number(slotForm.period_number),
        start_time: slotForm.start_time || null,
        end_time: slotForm.end_time || null,
        is_break: slotForm.is_break,
        is_active: slotForm.is_active,
      };
      if (slotEditing) {
        await updateTimeSlot(slotEditing.id, body);
        notify('Updated', 'success');
      } else {
        await createTimeSlot(body);
        notify('Created', 'success');
      }
      resetSlotForm();
      await load();
    } catch (err) { error = err.message; }
  }

  async function removeSlot(item) {
    if (!confirm(`Delete period ${item.period_number} on ${item.working_day?.name}?`)) return;
    try {
      await deleteTimeSlot(item.id);
      notify('Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const dayImportColumns = [
    { key: 'name', header: 'Name', sample: 'Monday' },
    { key: 'day_number', header: 'Day Number', sample: 1 },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImportDays(rows) {
    return importRows(rows, async (row) => {
      await createWorkingDay({ name: excelVal(row.Name), day_number: Number(row['Day Number']), is_active: excelBool(row.Active) ?? true });
    });
  }

  const slotImportColumns = [
    { key: 'working_day', header: 'Working Day', sample: 'Monday' },
    { key: 'period_number', header: 'Period Number', sample: 1 },
    { key: 'start_time', header: 'Start Time (HH:MM)', sample: '09:00' },
    { key: 'end_time', header: 'End Time (HH:MM)', sample: '10:00' },
    { key: 'break', header: 'Break', sample: 'FALSE' },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImportSlots(rows) {
    return importRows(rows, async (row) => {
      const dayName = excelVal(row['Working Day']);
      const day = days.find((d) => d.name === dayName);
      if (!day) throw new Error(`Unknown working day "${dayName}"`);
      await createTimeSlot({
        working_day_id: day.id,
        period_number: Number(row['Period Number']),
        start_time: excelVal(row['Start Time (HH:MM)']) || null,
        end_time: excelVal(row['End Time (HH:MM)']) || null,
        is_break: excelBool(row.Break) ?? false,
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1>Working Days & Time Slots</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="grid" style="align-items:start;margin:14px 0">
  <div class="card">
    <h2>{dayEditing ? 'Edit' : 'New'} working day</h2>
    <form on:submit={saveDay}>
      <div class="field">
        <label for="wd-name">Name</label>
        <input id="wd-name" bind:value={dayForm.name} required />
      </div>
      <div class="field">
        <label for="wd-num">Day number (1–7)</label>
        <input id="wd-num" type="number" min="1" max="7" bind:value={dayForm.day_number} required />
      </div>
      <div class="field">
        <label for="wd-active">Active</label>
        <input id="wd-active" type="checkbox" bind:checked={dayForm.is_active} />
      </div>
      <button class="btn-primary" type="submit">{dayEditing ? 'Save' : 'Create'}</button>
      {#if dayEditing}<button type="button" on:click={resetDayForm}>Cancel</button>{/if}
    </form>
  </div>

  <div class="card">
    <h2>{slotEditing ? 'Edit' : 'New'} time slot</h2>
    <form on:submit={saveSlot}>
      <div class="field">
        <label for="ts-day">Working day</label>
        <select id="ts-day" bind:value={slotForm.working_day_id} required>
          <option value="">— select —</option>
          {#each days as d}
            <option value={d.id}>{d.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="ts-period">Period number</label>
        <input id="ts-period" type="number" min="1" bind:value={slotForm.period_number} required />
      </div>
      <div class="field">
        <label for="ts-start">Start</label>
        <input id="ts-start" type="time" bind:value={slotForm.start_time} required />
      </div>
      <div class="field">
        <label for="ts-end">End</label>
        <input id="ts-end" type="time" bind:value={slotForm.end_time} required />
      </div>
      <div class="field">
        <label for="ts-break">Break</label>
        <input id="ts-break" type="checkbox" bind:checked={slotForm.is_break} />
      </div>
      <div class="field">
        <label for="ts-active">Active</label>
        <input id="ts-active" type="checkbox" bind:checked={slotForm.is_active} />
      </div>
      <button class="btn-primary" type="submit">{slotEditing ? 'Save' : 'Create'}</button>
      {#if slotEditing}<button type="button" on:click={resetSlotForm}>Cancel</button>{/if}
    </form>
  </div>
</div>

<div class="grid" style="align-items:start">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Working days</h2>
      <ExcelImport columns={dayImportColumns} onImport={onImportDays} templateName="working-days-template" label="working days" />
    </div>
    <Table
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'day_number', label: 'No.' },
        { key: 'slots', label: 'Slots', render: (r) => r.slot_count },
        { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
      ]}
      items={days}
      rowButtons={(item) => [
        { label: 'Edit', onClick: startEditDay },
        { label: 'Delete', class: 'btn-danger', onClick: removeDay },
      ]}
    />
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Time slots</h2>
      <ExcelImport columns={slotImportColumns} onImport={onImportSlots} templateName="time-slots-template" label="time slots" />
    </div>
    <Table
      columns={[
        { key: 'day', label: 'Day', render: (r) => r.working_day?.name || '—' },
        { key: 'period_number', label: 'Period' },
        { key: 'times', label: 'Time', render: (r) => `${(r.start_time || '').slice(0, 5)}–${(r.end_time || '').slice(0, 5)}` },
        { key: 'is_break', label: 'Break', render: (r) => r.is_break ? '✓' : '—' },
        { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
      ]}
      items={slots}
      rowButtons={(item) => [
        { label: 'Edit', onClick: startEditSlot },
        { label: 'Delete', class: 'btn-danger', onClick: removeSlot },
      ]}
    />
  </div>
</div>