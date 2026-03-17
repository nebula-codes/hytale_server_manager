import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { PermissionCode } from '../permissions/definitions';
import type { PermissionService } from '../services/PermissionService';


// JWT secret - must be set via environment variable (validated in auth routes on startup)
const JWT_SECRET = process.env.JWT_SECRET || '';

if (!JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET environment variable is required!');
}

const ACCESS_TOKEN_COOKIE = 'access_token';

export interface JWTPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  type: 'access' | 'refresh';
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

/**
 * Authentication middleware
 * Verifies JWT token from cookie or Authorization header and attaches user to request
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Try cookie first, then fall back to Authorization header (for WebSocket/API compatibility)
    const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const token = cookieToken || headerToken;

    if (!token) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;

      if (payload.type !== 'access') {
        res.status(401).json({ message: 'Invalid token type' });
        return;
      }

      // Verify user still exists
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, username: true, role: true },
      });

      if (!user) {
        res.status(401).json({ message: 'User not found' });
        return;
      }

      req.user = user;
      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({ message: 'Token expired' });
        return;
      }
      res.status(401).json({ message: 'Invalid token' });
      return;
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Role-based authorization middleware
 * Must be used after authenticate middleware
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Optional authentication middleware
 * Attaches user to request if valid token present, but doesn't require it
 */
export const optionalAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Try cookie first, then fall back to Authorization header
    const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const token = cookieToken || headerToken;

    if (!token) {
      next();
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;

      if (payload.type === 'access') {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, username: true, role: true },
        });

        if (user) {
          req.user = user;
        }
      }
    } catch {
      // Token invalid, but that's okay for optional auth
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next();
  }
};

/**
 * Permission-based authorization middleware
 * Checks if user has ALL required permissions
 * Must be used after authenticate middleware
 */
export const requirePermission = (...permissions: PermissionCode[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const permissionService = req.app.get('permissionService') as PermissionService;

    if (!permissionService) {
      logger.error('Permission service not available');
      res.status(500).json({ message: 'Permission service not configured' });
      return;
    }

    // Check if user has ALL required permissions
    const hasAllPermissions = permissions.every((p) =>
      permissionService.hasPermission(req.user!.role, p)
    );

    if (!hasAllPermissions) {
      res.status(403).json({
        message: 'Insufficient permissions',
        required: permissions,
      });
      return;
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 * Checks if user has ANY of the required permissions
 * Must be used after authenticate middleware
 */
export const requireAnyPermission = (...permissions: PermissionCode[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const permissionService = req.app.get('permissionService') as PermissionService;

    if (!permissionService) {
      logger.error('Permission service not available');
      res.status(500).json({ message: 'Permission service not configured' });
      return;
    }

    // Check if user has ANY of the required permissions
    const hasAnyPermission = permissions.some((p) =>
      permissionService.hasPermission(req.user!.role, p)
    );

    if (!hasAnyPermission) {
      res.status(403).json({
        message: 'Insufficient permissions',
        required: permissions,
      });
      return;
    }

    next();
  };
};
