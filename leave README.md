# Faculty Leave & Proxy Management System

A web application prototype for managing faculty leave, timetable entries, and automatic proxy allocation in a college.

## Features

- **Faculty Master** — add faculty members and departments.
- **Manual Timetable Entry** — enter faculty, day, start/end time, subject, semester, and room/lab.
- **Leave Management** — record leave date, day, time range, and reason.
- **Automatic Proxy Allocation** — finds a faculty member who is free during the affected class period.
- **Two-way timetable visibility** — proxy records can be viewed from both the absent faculty's and proxy faculty's timetable views.
- **Dashboard** — view faculty, leave, assigned proxy, and unassigned proxy counts.
- **Reports** — filter proxy records by faculty and copy report data as CSV.
- **Demo data** — sample faculty and timetable records are included in the prototype.

## How automatic allocation works

1. Find timetable entries belonging to the faculty member on leave.
2. Keep only entries whose time overlaps the leave period.
3. Exclude the absent faculty member.
4. Exclude faculty who have a regular class at the same time.
5. Exclude faculty already assigned to another proxy for that same date and time.
6. Exclude faculty who are on leave during the same date and time.
7. From the remaining eligible faculty, choose the one with the fewest existing proxy assignments.
8. Show the assignment in the proxy list and faculty timetable views.

If no eligible faculty member is available, the proxy is marked **Unassigned**.

## Prototype limitations

This is a front-end demonstration, not a production-ready college system.

- Data is kept in the current app session and may be lost when the page/session is refreshed or closed.
- There is no persistent database or server API.
- Login, role-based access, HOD approval, and audit logs are not implemented.
- Notifications (email/SMS/WhatsApp) are not implemented.
- Timetable entries are recurring by weekday in this prototype; production use should model actual dates and academic calendars.
- Time overlap is checked using the entered time strings. Enter times consistently in 24-hour `HH:MM` format.
- The optional same-department setting is a prototype allocation preference, not a substitute for institutional rules.
- Before real deployment, add server-side validation, authentication, database transactions, backups, and privacy/security controls.

## Suggested production architecture

- **Frontend:** React or Next.js
- **Backend:** Node.js/Express, Django, or another supported framework
- **Database:** PostgreSQL or MySQL
- **Authentication:** secure role-based login for Admin, HOD, and Faculty
- **Deployment:** HTTPS-enabled college server or trusted cloud hosting

### Suggested database tables

- `departments`
- `faculty`
- `subjects`
- `academic_sections`
- `timetable_entries`
- `leave_requests`
- `proxy_assignments`
- `users`
- `audit_logs`

### Important production rules

- Enforce no timetable overlap for the proxy faculty.
- Prevent a faculty member on approved leave from being allocated as a proxy.
- Prevent duplicate proxy assignments for the same class/date.
- Consider department, subject expertise, workload fairness, lab requirements, and faculty availability.
- Record who/what created or changed an allocation.
- Define how cancellations and reallocation affect both faculty timetables.
- Test edge cases such as multiple-day leave, holidays, timetable changes, and no available proxy.

## How to use the prototype

1. Open the prototype in the ChatGPT conversation where it is displayed.
2. Use **Faculty Master** to add faculty.
3. Use **Timetable Entry** to enter weekly timetable slots.
4. Use **Leave Management** to record a faculty member's leave.
5. Select **Allocate Proxy** for that leave entry.
6. Open **Proxy Allocation** to inspect assignments.
7. Open **Faculty Timetable** and select either faculty member to see the proxy relationship.
8. Use **Reports** to filter records and copy CSV data.

## License

No license has been specified yet. Add a license before distributing or deploying this software.
