<script>
  import { onMount } from 'svelte';
  import { listRooms, createRoom, updateRoom, deleteRoom, listDepartments, importRows, excelVal, excelBool } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  const ROOM_TYPES = ['classroom', 'laboratory', 'seminar_hall', 'workshop', 'other'];

  let items = [];
  let departments = [];
  let error = '';
  let form = {
    room_number: '',
    room_name: '',
    room_type: 'classroom',
    capacity: 40,
    department_id: '',
    is_available: true,
    is_active: true,
  };
  let editing = null;

  async function load() {
    [items, departments] = await Promise.all([listRooms(), listDepartments()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = {
      room_number: '',
      room_name: '',
      room_type: 'classroom',
      capacity: 40,
      department_id: '',
      is_available: true,
      is_active: true,
    };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      room_number: item.room_number,
      room_name: item.room_name,
      room_type: item.room_type,
      capacity: item.capacity,
      department_id: item.department_id || '',
      is_available: item.is_available,
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        room_number: form.room_number,
        room_name: form.room_name,
        room_type: form.room_type,
        capacity: Number(form.capacity),
        department_id: form.department_id || null,
        is_available: form.is_available,
        is_active: form.is_active,
      };
      if (editing) {
        await updateRoom(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createRoom(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.room_name}?`)) return;
    try {
      const r = await deleteRoom(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'room_number', header: 'Room Number', sample: 'A-101' },
    { key: 'room_name', header: 'Room Name', sample: 'Lecture Hall 1' },
    { key: 'room_type', header: 'Room Type', sample: 'classroom' },
    { key: 'capacity', header: 'Capacity', sample: 60 },
    { key: 'department_code', header: 'Department Code (optional)', sample: 'CSE' },
    { key: 'available', header: 'Available', sample: 'TRUE' },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      let dept = null;
      const deptCode = excelVal(row['Department Code (optional)']);
      if (deptCode) {
        dept = departments.find((d) => d.code.toLowerCase() === deptCode.toLowerCase());
        if (!dept) throw new Error(`Unknown department code "${deptCode}"`);
      }
      await createRoom({
        room_number: excelVal(row['Room Number']),
        room_name: excelVal(row['Room Name']),
        room_type: excelVal(row['Room Type']),
        capacity: Number(row.Capacity),
        department_id: dept?.id || null,
        is_available: excelBool(row.Available) ?? true,
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Rooms
  <ExcelImport columns={importColumns} onImport={onImport} templateName="rooms-template" label="rooms" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} room</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="room-num">Room number</label>
      <input id="room-num" bind:value={form.room_number} required />
    </div>
    <div class="field">
      <label for="room-name">Room name</label>
      <input id="room-name" bind:value={form.room_name} required />
    </div>
    <div class="field">
      <label for="room-type">Type</label>
      <select id="room-type" bind:value={form.room_type}>
        {#each ROOM_TYPES as t}
          <option value={t}>{t.replace('_', ' ')}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="room-cap">Capacity</label>
      <input id="room-cap" type="number" min="1" bind:value={form.capacity} required />
    </div>
    <div class="field">
      <label for="room-dept">Department (optional)</label>
      <select id="room-dept" bind:value={form.department_id}>
        <option value="">— none —</option>
        {#each departments as d}
          <option value={d.id}>{d.code} — {d.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="room-avail">Available</label>
      <input id="room-avail" type="checkbox" bind:checked={form.is_available} />
    </div>
    <div class="field">
      <label for="room-active">Active</label>
      <input id="room-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'room_number', label: 'Number' },
      { key: 'room_name', label: 'Name' },
      { key: 'room_type', label: 'Type', render: (r) => r.room_type?.replace('_', ' ') },
      { key: 'capacity', label: 'Capacity' },
      { key: 'department', label: 'Department', render: (r) => r.department?.name || '—' },
      { key: 'is_available', label: 'Available', render: (r) => r.is_available ? '✓' : '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>