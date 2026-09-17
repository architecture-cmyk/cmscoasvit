# 🎓 Education Timetable Management System

A dynamic timetable management platform for colleges/institutes to manage **Faculty, Subjects, Credits, Divisions, Rooms, Lesson Plans, Timetables and Faculty Attendance** from one centralized application.

## Tech Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Frontend   | SvelteKit + Svelte                  |
| Database   | Supabase (PostgreSQL)               |
| Auth       | Supabase Auth (email + password)    |
| Access     | Supabase RLS policies + row-level roles |
| Provision  | Supabase Edge Function (service-role) |
| Export     | PDF (jsPDF) + Excel (SheetJS) — client-side |

## Repository Layout

```
├── frontend/          SvelteKit application (talks directly to Supabase)
├── supabase/
│   ├── schema.sql     Full database schema (tables, RLS, triggers, indexes)
│   ├── seed.sql       Sample institutional data
│   └── functions/
│       └── provision-user/   Edge Function to create auth users + role rows
├── docs/
│   ├── database.md    Schema, relationships and security notes
│   └── api.md         REST API reference
├── .env.example       Environment variable template
└── README.md
```

## Features

- Dynamic faculty, subject, course/semester/division, and room management
- Faculty ↔ subject ↔ division mapping with availability checks
- Configurable college timings (Punch-in, periods, recess, punch-out)
- Lesson plans and faculty attendance
- Constraint-based automatic timetable generator
  - No faculty / division / room / lab overlaps
  - Respects weekly load, subject weekly hours, room capacity, room type
  - Blocks inactive/unavailable resources
  - Deterministic when a fixed `seed` is supplied
  - Transactional writes; reports unscheduled requirements on failure
- Timetable lifecycle: `draft → pending_approval → approved → published`(+ reject with comments, unpublish, archive)
- Division / Faculty / Subject / Room timetable views
- Faculty workload calculation and reports
- PDF & Excel report export
- Role-based access: **Admin**, **Head/HOD**, **Faculty** with Supabase RLS + backend enforcement
- Audit logging of approval/publish/admin actions

## Setup

### 1. Clone and prepare env

```bash
git clone <repo-url>
cd education-timetable
cp .env.example .env   # then fill in real Supabase values
```

### 2. Create the database

Run `supabase/schema.sql` then `supabase/seed.sql` in the Supabase SQL Editor.

### 3. Run the frontend

No backend is required — the app talks to Supabase directly (RLS authorizes every query).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env`.

### 4. Create users

Create users in Supabase Auth (email + password) and add matching role rows in the `users` table (see `seed.sql` / `docs/database.md`).

Alternatively, deploy the provisioning Edge Function for password-based user creation:

```bash
cd supabase
supabase functions deploy provision-user
# set SUPABASE_SERVICE_ROLE_KEY in the function's secrets
```

`POST /functions/v1/provision-user` creates an auth user + `users` row. It is open only when the `users` table is empty (first admin bootstrap); afterwards it requires an admin JWT.

## Example timetable generation

Generate from the UI (`Timetables → Generate`) as an admin. The generator runs client-side and persists a draft atomically via the `insert_timetable_entries` SQL function. Inputs:

| Field | Meaning |
| ----- | ------- |
| `academic_year_id` | Active academic year |
| `semester_id` | Semester for the year |
| `course_id` | Course |
| `division_ids` | Divisions to schedule |
| `working_day_ids` | Days (e.g. Monday, Tuesday, …) |
| `time_slot_ids` | Periods to use |
| `replace_existing_draft` | Drop existing drafts for the period first |
| `seed` | Optional integer for deterministic output |

## Default college timing

| Time             | Activity    |
| ---------------- | ----------- |
| 09:30 AM         | Punch-in    |
| 09:45 – 10:45    | Period 1    |
| 10:45 – 11:45    | Period 2    |
| 11:45 – 12:45    | Period 3    |
| 12:45 – 01:30 PM | Long recess |
| 01:30 – 02:30    | Period 4    |
| 02:30 – 03:30    | Period 5    |
| 03:30 – 04:25    | Period 6    |
| 04:30 PM         | Punch-out   |

Timings are fully dynamic via `Admin → Settings → Timetable Timing`.

## Security

- Supabase Authentication, Row Level Security, and JWT claims
- Row-level role checks via `current_user_role()` / `current_user_department()` / `current_user_faculty()` on every table
- Service role key is server-side only (Edge Functions)
- Atomic timetable writes through the `insert_timetable_entries` SECURITY DEFINER function
- Audit logging of approval/publish/admin actions (DB triggers + policies)
- Parameterized queries / Supabase client methods throughout

See `docs/api.md` and `docs/database.md` for full details.