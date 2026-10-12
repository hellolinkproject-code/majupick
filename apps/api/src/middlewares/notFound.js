import { HttpError } from '../utils/httpError.js';

export function notFound(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`));
}
