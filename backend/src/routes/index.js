import { Router } from 'express';
import { authRouter } from '../controllers/auth.controller.js';
import { facultyRouter } from '../controllers/faculty.controller.js';
import { subjectRouter, facultySubjectRouter } from '../controllers/subject.controller.js';
import {
  academicYearRouter, semesterRouter, courseRouter, divisionRouter,
} from '../controllers/course.controller.js';
import { roomRouter } from '../controllers/room.controller.js';
import { workingDayRouter, timeSlotRouter, settingsRouter } from '../controllers/timing.controller.js';
import { lessonPlanRouter } from '../controllers/lessonPlan.controller.js';
import { attendanceRouter } from '../controllers/attendance.controller.js';
import { timetableRouter } from '../controllers/timetable.controller.js';
import { reportRouter } from '../controllers/report.controller.js';
import { userRouter, auditRouter } from '../controllers/user.controller.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);

apiRouter.use('/faculty', facultyRouter);
apiRouter.use('/faculty-subjects', facultySubjectRouter);

apiRouter.use('/subjects', subjectRouter);
apiRouter.use('/courses', courseRouter);
apiRouter.use('/academic-years', academicYearRouter);
apiRouter.use('/semesters', semesterRouter);
apiRouter.use('/divisions', divisionRouter);
apiRouter.use('/rooms', roomRouter);
apiRouter.use('/working-days', workingDayRouter);
apiRouter.use('/time-slots', timeSlotRouter);
apiRouter.use('/settings', settingsRouter);

apiRouter.use('/lesson-plans', lessonPlanRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/timetables', timetableRouter);
apiRouter.use('/reports', reportRouter);

apiRouter.use('/users', userRouter);
apiRouter.use('/audit-logs', auditRouter);

// Health of the API
apiRouter.get('/ping', (_req, res) => res.json({ success: true, data: { pong: true }, message: 'pong' }));