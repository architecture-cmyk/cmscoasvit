# Supabase-first migration plan

This project is currently structured as a 3-layer app:

- Frontend: SvelteKit in `frontend/`
- Backend: Express API in `backend/`
- Database/Auth: Supabase in `supabase/`

The goal is to remove the Express backend safely and move the system toward a Supabase-first architecture.

## 1) Current architecture summary

The repo already tells us the intended stack in `README.md`:

- Frontend: SvelteKit + Svelte
- Backend: Node.js + Express
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth

The frontend calls the backend through `/api/v1` as seen in `frontend/src/lib/api.js`.

The backend starts the app in `backend/src/server.js` and creates the Supabase client in `backend/src/supabase.js`.

The backend is currently responsible for:

- user auth verification
- role enforcement and authorization
- timetable generation logic
- complex validation rules
- protected API endpoints
- reporting/export logic

Supabase is currently responsible for:

- database storage
- auth session and JWT validation
- database schema and data
- Row Level Security

## 2) Migration principle

Do not delete the backend first.

Instead:

1. Move standard CRUD and auth to Supabase
2. Move authorization to RLS
3. Move timetable generation to a dedicated function or isolated service
4. Switch frontend to Supabase
5. Remove Express only after everything still works

## 3) Phase-by-phase migration plan

### Phase 1: Inventory the backend API

List every route under `backend/src/routes` and ask:

- Can this be direct Supabase CRUD?
- Does this need server-side validation?
- Is this a business workflow?
- Is this a timetable algorithm or export task?

Typical categories:

- CRUD data management -> move to Supabase client or RPC
- Auth and user sessions -> move to Supabase Auth
- Role checks -> move to RLS + user profile table
- Timetable generation -> move to RPC/Edge Function or keep isolated backend service
- PDF/Excel export -> move to browser or serverless function

### Phase 2: Move auth to Supabase

Current backend auth is handled through Express + JWT validation.

Target state:

- Use Supabase Auth for login/logout/session
- Store user roles in `public.users`
- Use Supabase session access token on frontend
- Keep `public.users` as the source of truth for `admin`, `hod`, and `faculty`

Implementation steps:

- configure Supabase auth in frontend
- replace backend login flow
- migrate role rows into Supabase
- add RLS policies by role

### Phase 3: Move all CRUD to Supabase client

Move management screens and tables to direct Supabase queries.

Examples:

- departments
- academic_years
- courses
- semesters
- divisions
- faculty
- subjects
- rooms
- working_days
- time_slots
- lesson_plans

Use:

- `supabase.from('table').select(...)`
- `supabase.from('table').insert(...)`
- `supabase.from('table').update(...)`
- `supabase.from('table').delete(...)`

For complex multi-table actions, use PostgreSQL functions / RPCs instead of imperative backend code.

### Phase 4: Move authorization to RLS

Remove reliance on backend-only checks wherever possible.

Create policies for:

- admin can manage all records
- hod can manage department data
- faculty can view/edit only their assigned data

This should match the existing project design described in `README.md`.

### Phase 5: Replace the frontend API layer

Update `frontend/src/lib/api.js` to stop hitting `/api/v1` for normal CRUD operations.

Replace this pattern:

- `fetch('/api/v1/...')`

with:

- `supabase.from(...)`
- `supabase.rpc(...)`
- `supabase.auth.*`

This is the main refactor in the UI layer.

### Phase 6: Isolate timetable generation

This is the biggest migration risk.

The project specifically describes constraint-based generation logic in `README.md`:

- no overlaps
- room checks
- faculty checks
- lab restrictions
- load balancing
- transaction-safe generation
- approval workflow

This logic should not be put directly in the browser.

Options:

1. Keep a dedicated minimal backend service only for timetable generation
2. Move generation to a Supabase RPC function
3. Move generation to a Supabase Edge Function / serverless function

Recommendation:

- If you want a low-risk migration: keep a tiny backend for timetable generation only
- If you want a full Supabase-first migration: move generation to RPC or Edge Function and validate thoroughly

### Phase 7: Move reporting/export jobs

The app includes PDF/Excel export features.

Current backend likely uses:

- PDFKit
- ExcelJS

These can be:

- browser-side export when possible
- serverless function for large/report-heavy exports
- a lightweight backend service if needed

Keep this separate from the main data CRUD implementation.

### Phase 8: Remove the old backend

Only after all of the following are true:

- auth works via Supabase
- CRUD works via Supabase
- role restrictions work via RLS
- timetable generation works in the new location
- report/export works in the new location
- frontend no longer calls `/api/v1` for normal use

Then delete:

- `backend/src/`
- `backend/package.json`
- `backend/node_modules` if applicable
- old route/controller/middleware files

## 4) Recommended migration order for this repo

This is the safest order:

1. Audit backend routes and classify them
2. Move auth to Supabase
3. Move database CRUD to Supabase
4. Move RLS policies into schema
5. Replace frontend API calls
6. Move timetable generation to RPC/Edge Function or keep isolated backend
7. Move export logic
8. Remove Express

## 5) What should stay out of the browser

Any logic that should not live in frontend code:

- timetable scheduling algorithm
- authorization decisions
- audit logging
- sensitive business rules
- export generation for heavy reports

These should go to:

- database functions
- Supabase Edge Functions
- managed background workers
- a tiny dedicated API service if still needed

## 6) Keep complexity low

The cleanest version of this architecture is:

- Frontend: SvelteKit + Supabase client
- Database/Auth: Supabase
- Complex logic: Postgres functions / Edge Functions / optional minimal service

This avoids a full custom backend but still keeps business logic in a secure place.

## 7) Practical recommendation for this project

For this repo, a full immediate backend removal is not recommended.

The realistic migration is:

- remove the Express CRUD layer
- keep only the algorithmic or workflow-heavy backend if necessary
- move the rest to Supabase

This reduces risk while still moving the app toward a Supabase-first architecture.

## 8) Next immediate action

Create a migration checklist by route and then implement in this order:

- auth
- user roles and permissions
- departments and lookups
- faculty/subjects/rooms/divisions
- timetable generation
- exports
- cleanup

Once the checklist is complete, the app can be converted to a Supabase-first stack without a risky giant jump.
