import { AppError } from '../utils/errors.js';
import { env } from '../config.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...err.extra },
    });
  }

  // Errors tagged with a code by helpers (e.g. verifyToken)
  if (err && err.code === 'UNAUTHORIZED') {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: err.message || 'Authentication required' },
    });
  }
  if (err && err.code === 'FORBIDDEN') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: err.message } });
  }

  if (env.nodeEnv !== 'test') {
    console.error('[unhandled]', err);
  }
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
  });
}