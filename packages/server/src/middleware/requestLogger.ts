import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Paths to skip logging (prevents feedback loops and reduces noise)
const SKIP_PATHS = [
  '/api/system/logs',
  '/api/servers/metrics',
];

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Skip logging for noisy/polling endpoints
  if (SKIP_PATHS.some(path => req.path.startsWith(path))) {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });

  next();
}
