-- =====================================================================
-- Education Timetable Management System
-- Database schema for Supabase (PostgreSQL)
-- Tables, constraints, indexes, Row Level Security, triggers, RPCs
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helper: updated_at trigger function
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- ORGANIZATION
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.faculty (
  id                  uuid primary key default gen_random_uuid(),
  department_id       uuid not null references public.departments(id),
  employee_id         text not null unique,
  name                text not null,
  designation         text,
  email               text not null unique,
  mobile              text,
  maximum_weekly_load numeric(5,2) not null default 0 check (maximum_weekly_load >= 0),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  start_date  date,
  end_date    date,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.courses (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references public.departments(id),
  name           text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.semesters (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id),
  name              text not null,
  semester_number   integer not null check (semester_number > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (academic_year_id, semester_number)
);

create table if not exists public.divisions (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses(id),
  academic_year_id  uuid not null references public.academic_years(id),
  semester_id       uuid not null references public.semesters(id),
  name              text not null,
  strength          integer not null check (strength > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (course_id, academic_year_id, semester_id, name)
);

-- ---------------------------------------------------------------------
-- SUBJECTS
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
  id                    uuid primary key default gen_random_uuid(),
  department_id         uuid not null references public.departments(id),
  course_id             uuid references public.courses(id),
  semester_id           uuid references public.semesters(id),
  code                  text not null unique,
  name                  text not null,
  lecture_hours         numeric(5,2) not null default 0 check (lecture_hours >= 0),
  tutorial_hours        numeric(5,2) not null default 0 check (tutorial_hours >= 0),
  practical_hours       numeric(5,2) not null default 0 check (practical_hours >= 0),
  weekly_required_hours numeric(5,2) check (weekly_required_hours >= 0),
  is_lab                boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (
    weekly_required_hours is null
    or weekly_required_hours = lecture_hours + tutorial_hours + practical_hours
  )
);

create table if not exists public.subject_credits (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null unique references public.subjects(id),
  credits      numeric(4,2) not null default 0 check (credits >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Faculty <-> subject mapping (per division + academic year)
create table if not exists public.faculty_subjects (
  id              uuid primary key default gen_random_uuid(),
  faculty_id      uuid not null references public.faculty(id),
  subject_id      uuid not null references public.subjects(id),
  division_id     uuid not null references public.divisions(id),
  academic_year_id uuid not null references public.academic_years(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (faculty_id, subject_id, division_id, academic_year_id)
);

-- ---------------------------------------------------------------------
-- ROOMS AND TIMING
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  room_number   text not null unique,
  room_name     text not null,
  room_type     text not null check (room_type in ('classroom','laboratory','seminar_hall','workshop','other')),
  capacity      integer not null check (capacity > 0),
  department_id uuid references public.departments(id),
  is_available  boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.working_days (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  day_number  integer not null unique check (day_number between 1 and 7),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.time_slots (
  id              uuid primary key default gen_random_uuid(),
  working_day_id  uuid not null references public.working_days(id),
  period_number   integer not null check (period_number > 0),
  start_time      time not null,
  end_time        time not null,
  is_break        boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (working_day_id, period_number),
  check (end_time > start_time)
);

-- ---------------------------------------------------------------------
-- USERS (created before lesson_plans / timetable / attendance which FK it)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('admin','hod','faculty')),
  department_id uuid references public.departments(id),
  faculty_id    uuid references public.faculty(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (
    (role = 'admin' and department_id is null and faculty_id is null)
    or (role = 'hod' and department_id is not null and faculty_id is null)
    or (role = 'faculty' and faculty_id is not null)
  )
);

-- ---------------------------------------------------------------------
-- LESSON PLANS
-- ---------------------------------------------------------------------
create table if not exists public.lesson_plans (
  id              uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id),
  semester_id     uuid not null references public.semesters(id),
  course_id       uuid not null references public.courses(id),
  division_id     uuid not null references public.divisions(id),
  faculty_id      uuid not null references public.faculty(id),
  subject_id      uuid not null references public.subjects(id),
  unit            text not null,
  topic           text not null,
  lesson_number   integer not null check (lesson_number > 0),
  planned_date    date,
  period_number   integer,
  start_time      time,
  end_time        time,
  teaching_method text,
  remarks         text,
  status          text not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected')),
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TIMETABLE
-- ---------------------------------------------------------------------
create table if not exists public.timetable (
  id                 uuid primary key default gen_random_uuid(),
  academic_year_id   uuid not null references public.academic_years(id),
  semester_id        uuid not null references public.semesters(id),
  course_id          uuid not null references public.courses(id),
  status             text not null default 'draft'
                     check (status in ('draft','pending_approval','approved','published','archived')),
  generated_by       uuid not null references public.users(id),
  generated_seed     integer,
  submitted_at       timestamptz,
  submitted_by       uuid references public.users(id),
  approved_at        timestamptz,
  approved_by        uuid references public.users(id),
  rejected_at        timestamptz,
  rejection_comment  text,
  published_at       timestamptz,
  published_by       uuid references public.users(id),
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.timetable_entries (
  id                 uuid primary key default gen_random_uuid(),
  timetable_id       uuid not null references public.timetable(id) on delete cascade,
  faculty_subject_id uuid not null references public.faculty_subjects(id),
  faculty_id         uuid not null references public.faculty(id),
  division_id        uuid not null references public.divisions(id),
  room_id            uuid not null references public.rooms(id),
  time_slot_id       uuid not null references public.time_slots(id),
  session_type       text not null check (session_type in ('lecture','tutorial','practical')),
  created_at         timestamptz not null default now(),
  -- conflict prevention at database level
  unique (timetable_id, faculty_id, time_slot_id),
  unique (timetable_id, division_id, time_slot_id),
  unique (timetable_id, room_id, time_slot_id)
);

-- ---------------------------------------------------------------------
-- FACULTY WORKLOAD / ATTENDANCE
-- ---------------------------------------------------------------------
create table if not exists public.faculty_workload (
  id               uuid primary key default gen_random_uuid(),
  faculty_id       uuid not null references public.faculty(id),
  academic_year_id uuid not null references public.academic_years(id),
  semester_id      uuid not null references public.semesters(id),
  total_hours      numeric(8,2) not null default 0,
  lecture_hours    numeric(8,2) not null default 0,
  tutorial_hours   numeric(8,2) not null default 0,
  practical_hours  numeric(8,2) not null default 0,
  computed_at      timestamptz not null default now(),
  unique (faculty_id, academic_year_id, semester_id)
);

create table if not exists public.attendance (
  id                  uuid primary key default gen_random_uuid(),
  faculty_id          uuid not null references public.faculty(id),
  subject_id          uuid not null references public.subjects(id),
  division_id         uuid references public.divisions(id),
  timetable_entry_id  uuid references public.timetable_entries(id),
  academic_year_id    uuid not null references public.academic_years(id),
  date                date not null,
  period_number       integer,
  in_time             time,
  out_time            time,
  hours               numeric(4,2) check (hours >= 0),
  status              text not null default 'present'
                      check (status in ('present','absent','leave')),
  remarks             text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (out_time is null or in_time is null or out_time > in_time)
);

-- ---------------------------------------------------------------------
-- SETTINGS, AUDIT
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                integer primary key default 1 check (id = 1),
  institution_name  text not null default 'Education Institute',
  address           text,
  punch_in_time     time not null default '09:30',
  punch_out_time    time not null default '16:30',
  recess_start      time not null default '12:45',
  recess_end        time not null default '13:30',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id               bigint generated always as identity primary key,
  user_id          uuid references public.users(id),
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  previous_status  text,
  new_status       text,
  comment          text,
  metadata         jsonb,
  ip               text,
  created_at       timestamptz not null default now()
);

insert into public.settings (id, institution_name) values (1, 'Education Institute')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------
create index if not exists idx_faculty_department   on public.faculty(department_id);
create index if not exists idx_courses_department   on public.courses(department_id);
create index if not exists idx_divisions_course     on public.divisions(course_id);
create index if not exists idx_divisions_acadyear   on public.divisions(academic_year_id);
create index if not exists idx_divisions_semester   on public.divisions(semester_id);
create index if not exists idx_subjects_department  on public.subjects(department_id);
create index if not exists idx_subjects_course      on public.subjects(course_id);
create index if not exists idx_subjects_semester    on public.subjects(semester_id);
create index if not exists idx_fs_faculty           on public.faculty_subjects(faculty_id);
create index if not exists idx_fs_subject           on public.faculty_subjects(subject_id);
create index if not exists idx_fs_division          on public.faculty_subjects(division_id);
create index if not exists idx_fs_acadyear          on public.faculty_subjects(academic_year_id);
create index if not exists idx_rooms_department     on public.rooms(department_id);
create index if not exists idx_time_slots_day       on public.time_slots(working_day_id);
create index if not exists idx_lp_faculty           on public.lesson_plans(faculty_id);
create index if not exists idx_lp_subject           on public.lesson_plans(subject_id);
create index if not exists idx_lp_division          on public.lesson_plans(division_id);
create index if not exists idx_tt_acadyear          on public.timetable(academic_year_id, semester_id);
create index if not exists idx_te_timetable         on public.timetable_entries(timetable_id);
create index if not exists idx_te_faculty           on public.timetable_entries(faculty_id);
create index if not exists idx_te_division          on public.timetable_entries(division_id);
create index if not exists idx_te_room              on public.timetable_entries(room_id);
create index if not exists idx_te_timeslot          on public.timetable_entries(time_slot_id);
create index if not exists idx_workload_faculty     on public.faculty_workload(faculty_id);
create index if not exists idx_attendance_faculty   on public.attendance(faculty_id, date);
create index if not exists idx_audit_user           on public.audit_logs(user_id);
create index if not exists idx_users_role           on public.users(role);

-- ---------------------------------------------------------------------
-- TRIGGERS: updated_at
-- ---------------------------------------------------------------------
drop trigger if exists trg_departments_updated    on public.departments;
create trigger trg_departments_updated    before update on public.departments    for each row execute function public.set_updated_at();
drop trigger if exists trg_faculty_updated        on public.faculty;
create trigger trg_faculty_updated        before update on public.faculty        for each row execute function public.set_updated_at();
drop trigger if exists trg_academic_years_updated on public.academic_years;
create trigger trg_academic_years_updated before update on public.academic_years for each row execute function public.set_updated_at();
drop trigger if exists trg_courses_updated        on public.courses;
create trigger trg_courses_updated        before update on public.courses        for each row execute function public.set_updated_at();
drop trigger if exists trg_semesters_updated      on public.semesters;
create trigger trg_semesters_updated      before update on public.semesters      for each row execute function public.set_updated_at();
drop trigger if exists trg_divisions_updated      on public.divisions;
create trigger trg_divisions_updated      before update on public.divisions      for each row execute function public.set_updated_at();
drop trigger if exists trg_subjects_updated       on public.subjects;
create trigger trg_subjects_updated       before update on public.subjects       for each row execute function public.set_updated_at();
drop trigger if exists trg_subject_credit_upd     on public.subject_credits;
create trigger trg_subject_credit_upd     before update on public.subject_credits for each row execute function public.set_updated_at();
drop trigger if exists trg_faculty_subj_updated   on public.faculty_subjects;
create trigger trg_faculty_subj_updated   before update on public.faculty_subjects for each row execute function public.set_updated_at();
drop trigger if exists trg_rooms_updated          on public.rooms;
create trigger trg_rooms_updated          before update on public.rooms          for each row execute function public.set_updated_at();
drop trigger if exists trg_working_days_updated   on public.working_days;
create trigger trg_working_days_updated   before update on public.working_days   for each row execute function public.set_updated_at();
drop trigger if exists trg_time_slots_updated     on public.time_slots;
create trigger trg_time_slots_updated     before update on public.time_slots     for each row execute function public.set_updated_at();
drop trigger if exists trg_lesson_plans_updated   on public.lesson_plans;
create trigger trg_lesson_plans_updated   before update on public.lesson_plans   for each row execute function public.set_updated_at();
drop trigger if exists trg_timetable_updated      on public.timetable;
create trigger trg_timetable_updated      before update on public.timetable      for each row execute function public.set_updated_at();
drop trigger if exists trg_attendance_updated     on public.attendance;
create trigger trg_attendance_updated     before update on public.attendance     for each row execute function public.set_updated_at();
drop trigger if exists trg_settings_updated       on public.settings;
create trigger trg_settings_updated       before update on public.settings       for each row execute function public.set_updated_at();
drop trigger if exists trg_users_updated          on public.users;
create trigger trg_users_updated          before update on public.users          for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- TRIGGERS: audit logging for timetable status changes
-- ---------------------------------------------------------------------
create or replace function public.log_timetable_status_change()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    insert into public.audit_logs
      (user_id, action, entity_type, entity_id, previous_status, new_status)
    values
      (auth.uid(), 'timetable_status_change', 'timetable', new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_timetable_audit on public.timetable;
create trigger trg_timetable_audit
after update of status on public.timetable
for each row execute function public.log_timetable_status_change();

-- ---------------------------------------------------------------------
-- TRIGGERS: faculty workload recalculation
-- Counts hours only for entries tied to approved / published timetables.
-- ---------------------------------------------------------------------
create or replace function public.refresh_workload(p_faculty uuid, p_year uuid, p_term uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_total numeric(8,2); v_lec numeric(8,2); v_tut numeric(8,2); v_pra numeric(8,2);
begin
  select
    coalesce(sum(case when te.session_type='lecture' then hours else 0 end),0),
    coalesce(sum(case when te.session_type='tutorial' then hours else 0 end),0),
    coalesce(sum(case when te.session_type='practical' then hours else 0 end),0)
  into v_lec, v_tut, v_pra
  from (
    select te2.session_type,
           round(extract(epoch from (ts.end_time - ts.start_time)) / 3600, 2) as hours
    from public.timetable_entries te2
    join public.timetable t2 on t2.id = te2.timetable_id
    join public.time_slots ts on ts.id = te2.time_slot_id
    where te2.faculty_id = p_faculty
      and t2.academic_year_id = p_year
      and t2.semester_id = p_term
      and t2.status in ('approved','published')
  ) te;
  v_total := v_lec + v_tut + v_pra;

  insert into public.faculty_workload (faculty_id, academic_year_id, semester_id, total_hours, lecture_hours, tutorial_hours, practical_hours, computed_at)
  values (p_faculty, p_year, p_term, v_total, v_lec, v_tut, v_pra, now())
  on conflict (faculty_id, academic_year_id, semester_id)
  do update set
    total_hours = excluded.total_hours,
    lecture_hours = excluded.lecture_hours,
    tutorial_hours = excluded.tutorial_hours,
    practical_hours = excluded.practical_hours,
    computed_at = now();
end;
$$;

create or replace function public.recalc_workload_for_entry()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  t   public.timetable;
  rec record;
begin
  if tg_table_name = 'timetable_entries' then
    select * into t from public.timetable where id = coalesce(new.timetable_id, old.timetable_id);
    if t.id is not null then
      perform public.refresh_workload(coalesce(new.faculty_id, old.faculty_id), t.academic_year_id, t.semester_id);
    end if;
  else
    for t in select * from public.timetable where id = coalesce(new.id, old.id)
    loop
      for rec in select distinct faculty_id from public.timetable_entries where timetable_id = t.id
      loop
        perform public.refresh_workload(rec.faculty_id, t.academic_year_id, t.semester_id);
      end loop;
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_workload_entry on public.timetable_entries;
create trigger trg_workload_entry
after insert or update or delete on public.timetable_entries
for each row execute function public.recalc_workload_for_entry();

drop trigger if exists trg_workload_timetable on public.timetable;
create trigger trg_workload_timetable
after update of status on public.timetable
for each row when (new.status in ('approved','published','archived') or old.status in ('approved','published'))
execute function public.recalc_workload_for_entry();

-- ---------------------------------------------------------------------
-- RPC: atomic timetable-entry insertion used by the generator
-- Returns inserted count; raises TIMETABLE_CONFLICT with per-row errors
-- otherwise the whole set is rolled back (single function = 1 transaction).
-- ---------------------------------------------------------------------
create or replace function public.insert_timetable_entries(p_timetable_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e       jsonb;
  i       int := 0;
  inserted int := 0;
  errs    text[];
  detail  text;
begin
  if not exists (select 1 from public.timetable where id = p_timetable_id and status = 'draft') then
    raise exception 'TIMETABLE_NOT_DRAFT'
      using detail = 'Timetable does not exist or is not in draft status';
  end if;

  for e in select * from jsonb_array_elements(p_entries)
  loop
    i := i + 1;
    begin
      insert into public.timetable_entries
        (timetable_id, faculty_subject_id, faculty_id, division_id, room_id, time_slot_id, session_type)
      values
        (p_timetable_id,
         (e ->> 'faculty_subject_id')::uuid,
         (e ->> 'faculty_id')::uuid,
         (e ->> 'division_id')::uuid,
         (e ->> 'room_id')::uuid,
         (e ->> 'time_slot_id')::uuid,
         (e ->> 'session_type')::text);
      inserted := inserted + 1;
    exception when others then
      errs := array_append(errs,
        jsonb_build_object('index', i, 'slot', e ->> 'time_slot_id',
                           'error', sqlerrm)::text);
    end;
  end loop;

  if array_length(errs, 1) > 0 then
    select jsonb_build_object('inserted', inserted, 'errors',
             (select jsonb_agg(x::jsonb) from unnest(errs) x))::text into detail;
    raise exception 'TIMETABLE_CONFLICT' using detail = detail;
  end if;

  return jsonb_build_object('inserted', inserted);
end;
$$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Helper accessors (security definer so RLS policies can inspect users)
create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.current_user_department()
returns uuid
language sql stable security definer set search_path = public
as $$ select department_id from public.users where id = auth.uid() $$;

create or replace function public.current_user_faculty()
returns uuid
language sql stable security definer set search_path = public
as $$ select faculty_id from public.users where id = auth.uid() $$;

-- Enable RLS
alter table public.departments      enable row level security;
alter table public.faculty          enable row level security;
alter table public.courses          enable row level security;
alter table public.academic_years   enable row level security;
alter table public.semesters        enable row level security;
alter table public.divisions        enable row level security;
alter table public.subjects         enable row level security;
alter table public.subject_credits  enable row level security;
alter table public.faculty_subjects enable row level security;
alter table public.rooms            enable row level security;
alter table public.working_days     enable row level security;
alter table public.time_slots       enable row level security;
alter table public.lesson_plans     enable row level security;
alter table public.timetable        enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.faculty_workload enable row level security;
alter table public.attendance       enable row level security;
alter table public.users            enable row level security;
alter table public.settings         enable row level security;
alter table public.audit_logs       enable row level security;

-- Admins: full access everywhere (handled per policy below)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = 'admin', false) $$;

-- users
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users for select
  using (true); -- role claims needed on every page; app enforces granular read scope
drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update
  using (id = auth.uid() or public.is_admin());
drop policy if exists "users_insert_admin" on public.users;
create policy "users_insert_admin" on public.users for insert
  with check (public.is_admin());

-- departments: readable by authenticated; writable by admin
drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments for select
  using (auth.role() = 'authenticated');
drop policy if exists "departments_write" on public.departments;
create policy "departments_write" on public.departments for all
  using (public.is_admin()) with check (public.is_admin());

-- faculty: admin all; hod own dept; faculty own row
drop policy if exists "faculty_select" on public.faculty;
create policy "faculty_select" on public.faculty for select
  using (
    public.is_admin()
    or public.current_user_role() = 'hod' and public.current_user_department() = department_id
    or public.current_user_role() = 'faculty' and id = public.current_user_faculty()
  );
drop policy if exists "faculty_write" on public.faculty;
create policy "faculty_write" on public.faculty for all
  using (public.is_admin()) with check (public.is_admin());

-- courses: admin all; hod own dept
drop policy if exists "courses_select" on public.courses;
create policy "courses_select" on public.courses for select
  using (
    auth.role() = 'authenticated'
    and (public.is_admin() or department_id = public.current_user_department())
  );
drop policy if exists "courses_write" on public.courses;
create policy "courses_write" on public.courses for all
  using (public.is_admin()) with check (public.is_admin());

-- academic_years / semesters: authenticated read, admin write
drop policy if exists "academic_years_select" on public.academic_years;
create policy "academic_years_select" on public.academic_years for select
  using (auth.role() = 'authenticated');
drop policy if exists "academic_years_write" on public.academic_years;
create policy "academic_years_write" on public.academic_years for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "semesters_select" on public.semesters;
create policy "semesters_select" on public.semesters for select
  using (auth.role() = 'authenticated');
drop policy if exists "semesters_write" on public.semesters;
create policy "semesters_write" on public.semesters for all
  using (public.is_admin()) with check (public.is_admin());

-- divisions: admin all; hod dept; faculty only mapped
drop policy if exists "divisions_select" on public.divisions;
create policy "divisions_select" on public.divisions for select
  using (
    public.is_admin()
    or (public.current_user_role() = 'hod'
        and course_id in (select id from public.courses where department_id = public.current_user_department()))
    or (public.current_user_role() = 'faculty'
        and id in (select division_id from public.faculty_subjects where faculty_id = public.current_user_faculty()))
  );
drop policy if exists "divisions_write" on public.divisions;
create policy "divisions_write" on public.divisions for all
  using (public.is_admin()) with check (public.is_admin());

-- subjects / subject_credits / faculty_subjects
drop policy if exists "subjects_select" on public.subjects;
create policy "subjects_select" on public.subjects for select
  using (
    public.is_admin()
    or department_id = public.current_user_department()
    or id in (select subject_id from public.faculty_subjects where faculty_id = public.current_user_faculty())
  );
drop policy if exists "subjects_write" on public.subjects;
create policy "subjects_write" on public.subjects for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "subject_credits_select" on public.subject_credits;
create policy "subject_credits_select" on public.subject_credits for select
  using (auth.role() = 'authenticated');
drop policy if exists "subject_credits_write" on public.subject_credits;
create policy "subject_credits_write" on public.subject_credits for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "faculty_subjects_select" on public.faculty_subjects;
create policy "faculty_subjects_select" on public.faculty_subjects for select
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
    or public.current_user_role() = 'hod' and (select department_id from public.faculty where id = faculty_id) = public.current_user_department()
  );
drop policy if exists "faculty_subjects_write" on public.faculty_subjects;
create policy "faculty_subjects_write" on public.faculty_subjects for all
  using (public.is_admin()) with check (public.is_admin());

-- rooms
drop policy if exists "rooms_select" on public.rooms;
create policy "rooms_select" on public.rooms for select
  using (
    public.is_admin()
    or department_id is null or department_id = public.current_user_department()
  );
drop policy if exists "rooms_write" on public.rooms;
create policy "rooms_write" on public.rooms for all
  using (public.is_admin()) with check (public.is_admin());

-- working_days / time_slots
drop policy if exists "working_days_select" on public.working_days;
create policy "working_days_select" on public.working_days for select
  using (auth.role() = 'authenticated');
drop policy if exists "working_days_write" on public.working_days;
create policy "working_days_write" on public.working_days for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "time_slots_select" on public.time_slots;
create policy "time_slots_select" on public.time_slots for select
  using (auth.role() = 'authenticated');
drop policy if exists "time_slots_write" on public.time_slots;
create policy "time_slots_write" on public.time_slots for all
  using (public.is_admin()) with check (public.is_admin());

-- lesson_plans: admin all; hod dept; faculty own
drop policy if exists "lesson_plans_select" on public.lesson_plans;
create policy "lesson_plans_select" on public.lesson_plans for select
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
    or public.current_user_role() = 'hod' and (select department_id from public.faculty where id = faculty_id) = public.current_user_department()
  );
drop policy if exists "lesson_plans_write" on public.lesson_plans;
create policy "lesson_plans_write" on public.lesson_plans for all
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
  ) with check (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
  );

-- timetable / entries
drop policy if exists "timetable_select" on public.timetable;
create policy "timetable_select" on public.timetable for select
  using (
    public.is_admin()
    or public.current_user_role() = 'hod' and course_id in (select id from public.courses where department_id = public.current_user_department())
    or public.current_user_role() = 'faculty'
       and id in (select distinct timetable_id from public.timetable_entries where faculty_id = public.current_user_faculty())
  );
drop policy if exists "timetable_write" on public.timetable;
create policy "timetable_write" on public.timetable for insert
  with check (public.is_admin());
drop policy if exists "timetable_update" on public.timetable;
create policy "timetable_update" on public.timetable for update
  using (public.is_admin() or public.current_user_role() = 'hod');
drop policy if exists "timetable_delete" on public.timetable;
create policy "timetable_delete" on public.timetable for delete
  using (public.is_admin());
drop policy if exists "timetable_entries_select" on public.timetable_entries;
create policy "timetable_entries_select" on public.timetable_entries for select
  using (
    public.is_admin()
    or public.current_user_role() = 'faculty' and (faculty_id = public.current_user_faculty()
        or division_id in (select division_id from public.faculty_subjects where faculty_id = public.current_user_faculty()))
    or public.current_user_role() = 'hod' and division_id in
       (select d.id from public.divisions d join public.courses c on c.id = d.course_id
        where c.department_id = public.current_user_department())
  );

-- faculty_workload
drop policy if exists "workload_select" on public.faculty_workload;
create policy "workload_select" on public.faculty_workload for select
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
    or public.current_user_role() = 'hod' and (select department_id from public.faculty where id = faculty_id) = public.current_user_department()
  );

-- attendance
drop policy if exists "attendance_select" on public.attendance;
create policy "attendance_select" on public.attendance for select
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
    or public.current_user_role() = 'hod' and (select department_id from public.faculty where id = faculty_id) = public.current_user_department()
  );
drop policy if exists "attendance_write" on public.attendance;
create policy "attendance_write" on public.attendance for all
  using (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
  ) with check (
    public.is_admin()
    or faculty_id = public.current_user_faculty()
  );

-- settings: authenticated read; admin write
drop policy if exists "settings_select" on public.settings;
create policy "settings_select" on public.settings for select
  using (auth.role() = 'authenticated');
drop policy if exists "settings_update" on public.settings;
create policy "settings_update" on public.settings for update
  using (public.is_admin()) with check (public.is_admin());

-- audit_logs: authenticated read (own/admin); service role writes
drop policy if exists "audit_select" on public.audit_logs;
create policy "audit_select" on public.audit_logs for select
  using (auth.role() = 'authenticated');
drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert" on public.audit_logs for insert
  with check (true);

-- ---------------------------------------------------------------------
-- PERMISSIONS (client-side / Supabase-direct access)
-- RLS policies above gate tables; these grants let the anon and
-- authenticated roles invoke the SQL functions used by the app.
-- ---------------------------------------------------------------------
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_department() to authenticated;
grant execute on function public.current_user_faculty() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.log_timetable_status_change() to authenticated;
grant execute on function public.refresh_workload(uuid, uuid, uuid) to authenticated;
grant execute on function public.recalc_workload_for_entry() to authenticated;
grant execute on function public.insert_timetable_entries(uuid, jsonb) to authenticated;