import { z } from 'zod';
import { validationError } from './errors.js';

const pathLabel = (issue) => issue.path.join('.') || '_root';

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        fields[pathLabel(issue)] = issue.message;
      }
      return next(validationError(fields));
    }
    req.body = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        fields[pathLabel(issue)] = issue.message;
      }
      return next(validationError(fields));
    }
    req.query = result.data;
    return next();
  };
}

// Common zod schemas
export const uuidSchema = z.string().uuid('Must be a valid UUID');
export const optionalUuid = z.string().uuid('Must be a valid UUID').nullable().optional();
export const nameSchema = z.string().trim().min(1, 'Required').max(200, 'Too long');
export const emailSchema = z.string().trim().email('Must be a valid email address').max(254);
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a valid HH:MM time');
export const positiveNumber = (msg = 'Must be a non-negative number') =>
  z.coerce.number().finite(msg).min(0, msg);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().optional(),
  department_id: z.string().uuid().optional(),
  course_id: z.string().uuid().optional(),
  division_id: z.string().uuid().optional(),
  semester_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().optional(),
  faculty_id: z.string().uuid().optional(),
  status: z.string().trim().optional(),
  room_type: z.string().trim().optional(),
  role: z.string().trim().optional(),
  is_active: z.enum(['true', 'false']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});