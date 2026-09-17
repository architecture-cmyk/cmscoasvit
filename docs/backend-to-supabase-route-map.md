# Backend to Supabase route migration map

This file maps the current Express API routes in `backend/src/routes/index.js` to the likely Supabase destination and the recommended migration strategy.

## 1) Route inventory

### Auth and user access

- `/api/v1/auth`
  - Migration target: Supabase Auth + `public.users`
  - Move first
  - Keep role-based access in RLS policies
  - Replace custom JWT verification with Supabase session access tokens

- `/api/v1/users`
  - Migration target: `public.users`
  - Move early
  - Use `public.users` as source of truth for `admin`, `hod`, and `faculty`

- `/api/v1/audit-logs`
  - Migration target: `public.audit_logs` (or equivalent audit table)
  - Move after auth is stable
  - Prefer DB triggers or serverless logging for writes

### Core master data

- `/api/v1/faculty`
  - Target: `public.faculty`
  - Move to Supabase CRUD

- `/api/v1/faculty-subjects`
  - Target: `public.faculty_subjects`
  - Move to Supabase CRUD or RPC

- `/api/v1/subjects`
  - Target: `public.subjects`
  - Move to Supabase CRUD

- `/api/v1/courses`
  - Target: `public.courses`
  - Move to Supabase CRUD

- `/api/v1/academic-years`
  - Target: `public.academic_years`
  - Move to Supabase CRUD

- `/api/v1/semesters`
  - Target: `public.semesters`
  - Move to Supabase CRUD

- `/api/v1/divisions`
  - Target: `public.divisions`
  - Move to Supabase CRUD

- `/api/v1/rooms`
  - Target: `public.rooms`
  - Move to Supabase CRUD

- `/api/v1/working-days`
  - Target: `public.working_days`
  - Move to Supabase CRUD

- `/api/v1/time-slots`
  - Target: `public.time_slots`
  - Move to Supabase CRUD

- `/api/v1/settings`
  - Target: settings table in Supabase
  - Move to Supabase CRUD or config table

### Academic workflow and scheduling

- `/api/v1/lesson-plans`
  - Target: `public.lesson_plans`
  - Move to Supabase CRUD

- `/api/v1/attendance`
  - Target: `public.attendance` or equivalent attendance tables
  - Keep validation logic in DB or minimal API service

- `/api/v1/timetables`
  - Target: timetable tables in Supabase
  - The generation endpoint should be kept in a dedicated service or RPC until fully migrated
  - High-risk path: move last

- `/api/v1/reports`
  - Target: report queries + export generation
  - Move to a serverless/export workflow or browser export after validation

## 2) Migration priority order

### Priority 1: auth + user access

1. `/auth`
2. `/users`
3. `/audit-logs`

Reason: without auth and identity, the rest of the app cannot be safely migrated.

### Priority 2: master data tables

1. `/faculty`
2. `/subjects`
3. `/courses`
4. `/academic-years`
5. `/semesters`
6. `/divisions`
7. `/rooms`
8. `/working-days`
9. `/time-slots`
10. `/settings`

Reason: these are standard CRUD screens and easiest to convert to Supabase.

### Priority 3: academic workflow

1. `/lesson-plans`
2. `/attendance`

Reason: still business logic-heavy, but manageable with Supabase tables and triggers.

### Priority 4: timetable and reports

1. `/timetables`
2. `/reports`

Reason: these are the highest complexity and should be migrated after the data model is stable.

## 3) What can move directly

These should be converted to direct Supabase queries first:

- all master data screens
- lesson plans
- user profiles
- role data
- lookup settings

## 4) What should stay isolated temporarily

These are the parts you should not move into the browser immediately:

- timetable generation
- constraint validation
- report exports
- approval workflows
- audit logging on sensitive actions

Recommended placement:

- Supabase RPC functions
- Supabase Edge Functions
- a separate minimal backend service only for scheduling and reporting

## 5) Recommended migration sequence for this repo

1. Convert `/auth` to Supabase Auth
2. Convert `/users` to `public.users`
3. Convert `/faculty`, `/subjects`, `/courses`, `/academic-years`, `/semesters`, `/divisions` to Supabase
4. Convert `/rooms`, `/working-days`, `/time-slots`, `/settings`
5. Convert `/lesson-plans`
6. Convert `/attendance`
7. Move `/timetables` generator to RPC/Edge Function or minimal backend
8. Move `/reports` export to serverless/browser export
9. Remove backend after validation

## 6) Final recommendation

This project should not be converted to a pure Supabase-only frontend in one step.

The safe target architecture is:

- Frontend: SvelteKit + Supabase client
- Database/Auth: Supabase
- Complex logic: Postgres functions / Edge Functions / optional minimal service

That gives you a Supabase-first setup without breaking the timetable generator.
