export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message = 'Bad request') => new AppError(400, 'BAD_REQUEST', message);
export const validationError = (fields, message = 'Invalid request') =>
  new AppError(400, 'VALIDATION_ERROR', message, { fields });
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Insufficient permissions') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict with existing data') =>
  new AppError(409, 'CONFLICT', message);
export const unprocessable = (message = 'Unprocessable entity') =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message);
export const internal = (message = 'Internal server error') =>
  new AppError(500, 'INTERNAL_SERVER_ERROR', message);

export function assertFound(row, message = 'Resource not found') {
  if (!row) throw notFound(message);
  return row;
}

export function assertAccess(condition, message = 'Insufficient permissions') {
  if (!condition) throw forbidden(message);
}

// Narrow a database error into a stable API error.
export function fromDbError(error, message = 'Database operation failed') {
  const msg = error?.message || message;
  const code = error?.code;
  if (code === '23505' || /duplicate key|already exists/i.test(msg)) {
    return conflict('Duplicate value violates a unique constraint');
  }
  if (code === '23503') {
    return new AppError(422, 'UNPROCESSABLE_ENTITY', 'Referenced record does not exist');
  }
  if (code === '23514') {
    return new AppError(422, 'UNPROCESSABLE_ENTITY', 'Value violates a check constraint');
  }
  if (/TIMETABLE_CONFLICT/i.test(msg)) {
    let extra = {};
    try {
      if (error?.details) extra = { conflicts: JSON.parse(error.details) };
    } catch {
      /* ignore */
    }
    return new AppError(409, 'TIMETABLE_CONFLICT', 'Timetable contains unresolved conflicts', extra);
  }
  if (/TIMETABLE_NOT_DRAFT/i.test(msg)) {
    return conflict('Timetable does not exist or is not editable');
  }
  if (/invalid input syntax for type uuid/i.test(msg)) {
    return badRequest('A provided UUID is not valid');
  }
  return new AppError(500, 'INTERNAL_SERVER_ERROR', message);
}