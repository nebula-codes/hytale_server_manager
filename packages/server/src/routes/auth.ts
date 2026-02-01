import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { ActivityLogService } from '../services/ActivityLogService';
import { ACTIVITY_ACTIONS, RESOURCE_TYPES } from '../constants/ActivityLogActions';
import { getActivityContext } from '../middleware/activityLogger';
import { strictLimiter } from '../middleware/rateLimiter';

const prisma = new PrismaClient();

// JWT configuration - REQUIRE secrets from environment
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(`CRITICAL: ${name} environment variable is required!`);
    logger.error('Generate secrets with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }
  return value;
}

const JWT_SECRET = getRequiredEnvVar('JWT_SECRET');
const JWT_REFRESH_SECRET = getRequiredEnvVar('JWT_REFRESH_SECRET');

const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '7d';
const REMEMBER_ME_EXPIRY = '30d';

// Account lockout settings
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Cookie settings
// secure: true in production by default (requires HTTPS)
// Set INSECURE_COOKIES=true to allow HTTP (not recommended, only for local network testing)
const isProduction = process.env.NODE_ENV === 'production';
const allowInsecureCookies = process.env.INSECURE_COOKIES === 'true';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction && !allowInsecureCookies,
  sameSite: 'lax' as const,
  path: '/',
};

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

// In-memory storage for failed login attempts on non-existent usernames
// This prevents username enumeration by applying lockout to invalid usernames too
interface FailedAttempt {
  count: number;
  lockedUntil: Date | null;
}
const failedAttemptsByIpAndUsername = new Map<string, FailedAttempt>();

// Clean up old entries periodically (every hour)
setInterval(() => {
  const now = new Date();
  for (const [key, attempt] of failedAttemptsByIpAndUsername.entries()) {
    // Remove entries that are no longer locked and haven't had attempts recently
    if (!attempt.lockedUntil || attempt.lockedUntil < now) {
      failedAttemptsByIpAndUsername.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Validate password complexity
 * Requirements: 12+ chars, uppercase, lowercase, number, special char
 */
function validatePasswordComplexity(password: string): { valid: boolean; message: string } {
  if (password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  return { valid: true, message: 'Password meets requirements' };
}

interface JWTPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  type: 'access' | 'refresh';
}

/**
 * Create auth routes
 */
export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * Check if initial setup is required (no admin exists yet)
   */
  async function isSetupRequired(): Promise<boolean> {
    const adminCount = await prisma.user.count({
      where: { role: 'admin' },
    });
    return adminCount === 0;
  }

  /**
   * GET /api/auth/setup
   * Check if initial admin setup is required
   */
  router.get('/setup', async (_req: Request, res: Response) => {
    try {
      const setupRequired = await isSetupRequired();
      return res.json({ setupRequired });
    } catch (error) {
      logger.error('Setup status error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * POST /api/auth/setup
   * Create the initial admin account (only allowed when no admin exists)
   */
  router.post('/setup', strictLimiter, async (req: Request, res: Response) => {
    try {
      const setupRequired = await isSetupRequired();

      if (!setupRequired) {
        return res.status(409).json({ message: 'Initial setup already completed' });
      }

      const { email, username, password } = req.body;

      if (!email || !username || !password) {
        return res.status(400).json({ message: 'Email, username, and password are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      if (username.length < 3 || username.length > 32) {
        return res.status(400).json({ message: 'Username must be between 3 and 32 characters' });
      }

      const passwordValidation = validatePasswordComplexity(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ message: passwordValidation.message });
      }

      const normalizedEmail = email.toLowerCase();
      const normalizedUsername = username.toLowerCase();

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { username: normalizedUsername },
          ],
        },
      });

      if (existingUser) {
        return res.status(409).json({ message: 'Email or username already in use' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      await prisma.user.create({
        data: {
          email: normalizedEmail,
          username: normalizedUsername,
          passwordHash,
          role: 'admin',
        },
      });

      logger.info(`Initial admin account created: ${normalizedUsername}`);
      return res.status(201).json({ message: 'Admin account created' });
    } catch (error) {
      logger.error('Initial setup error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * Generate access token
   */
  function generateAccessToken(user: { id: string; email: string; username: string; role: string }, rememberMe = false): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'access',
      } as JWTPayload,
      JWT_SECRET,
      { expiresIn: rememberMe ? REMEMBER_ME_EXPIRY : ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generate refresh token
   */
  function generateRefreshToken(user: { id: string; email: string; username: string; role: string }): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'refresh',
      } as JWTPayload,
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );
  }

  /**
   * Verify access token
   */
  function verifyAccessToken(token: string): JWTPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
      if (payload.type !== 'access') return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Verify refresh token
   */
  function verifyRefreshToken(token: string): JWTPayload | null {
    try {
      const payload = jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
      if (payload.type !== 'refresh') return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * POST /api/auth/login
   * Login with username/email and password
   * Rate limited to prevent brute force attacks
   */
  router.post('/login', strictLimiter, async (req: Request, res: Response) => {
    try {
      const setupRequired = await isSetupRequired();
      if (setupRequired) {
        return res.status(409).json({
          message: 'Initial setup required. Create an admin account first.',
        });
      }

      const { identifier, password, rememberMe } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({
          message: 'Username/email and password are required',
        });
      }

      // Get IP address for tracking failed attempts
      const context = getActivityContext(req);
      const ipAndUsername = `${context.ipAddress}:${identifier.toLowerCase()}`;

      // Check in-memory lockout for non-existent usernames (prevents enumeration)
      const failedAttempt = failedAttemptsByIpAndUsername.get(ipAndUsername);
      if (failedAttempt?.lockedUntil && new Date(failedAttempt.lockedUntil) > new Date()) {
        const remainingMs = new Date(failedAttempt.lockedUntil).getTime() - Date.now();
        const remainingMins = Math.ceil(remainingMs / 60000);
        logger.warn(`Login failed: temporary lockout for identifier "${identifier}" from IP ${context.ipAddress}`);

        return res.status(423).json({
          message: `Too many failed attempts. Try again in ${remainingMins} minute${remainingMins > 1 ? 's' : ''}.`,
          lockedUntil: failedAttempt.lockedUntil,
        });
      }

      // Find user by email or username
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier.toLowerCase() },
            { username: identifier.toLowerCase() },
          ],
        },
      });

      if (!user) {
        // Perform a dummy bcrypt comparison to prevent timing attacks
        await bcrypt.compare(password, '$2a$12$dummyhashtopreventtimingattack1234567890123456789012345678');

        logger.warn(`Login failed: user not found for identifier "${identifier}"`);

        // Track failed attempt for non-existent username
        const attempt = failedAttemptsByIpAndUsername.get(ipAndUsername) || { count: 0, lockedUntil: null };
        attempt.count += 1;

        if (attempt.count >= MAX_FAILED_ATTEMPTS) {
          attempt.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
          logger.warn(`Temporary lockout applied for identifier "${identifier}" from IP ${context.ipAddress} after ${attempt.count} failed attempts`);
        }

        failedAttemptsByIpAndUsername.set(ipAndUsername, attempt);

        // Log failed attempt
        const activityLogService: ActivityLogService = req.app.get('activityLogService');
        activityLogService.logAsync({
          userId: 'unknown',
          username: identifier,
          userRole: 'unknown',
          action: ACTIVITY_ACTIONS.AUTH_LOGIN_FAILED,
          resourceType: RESOURCE_TYPES.USER,
          resourceName: identifier,
          status: 'failed',
          errorMessage: 'Invalid credentials',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        // Return the same error as invalid password to prevent enumeration
        return res.status(401).json({
          message: 'Invalid username/email or password',
        });
      }

      // Check if account is locked
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
        const remainingMins = Math.ceil(remainingMs / 60000);
        logger.warn(`Login failed: account locked for user "${user.username}"`);

        // Use the same message as non-existent username lockout to prevent enumeration
        return res.status(423).json({
          message: `Too many failed attempts. Try again in ${remainingMins} minute${remainingMins > 1 ? 's' : ''}.`,
          lockedUntil: user.lockedUntil,
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        // Increment failed attempts
        const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;
        const shouldLock = newFailedAttempts >= MAX_FAILED_ATTEMPTS;
        const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newFailedAttempts,
            lockedUntil,
          },
        });

        if (shouldLock) {
          logger.warn(`Account locked for user "${user.username}" after ${newFailedAttempts} failed attempts`);
        } else {
          logger.warn(`Login failed: invalid password for user "${user.username}" (attempt ${newFailedAttempts}/${MAX_FAILED_ATTEMPTS})`);
        }

        // Log failed attempt
        const activityLogService: ActivityLogService = req.app.get('activityLogService');
        activityLogService.logAsync({
          userId: user.id,
          username: user.username,
          userRole: user.role,
          action: ACTIVITY_ACTIONS.AUTH_LOGIN_FAILED,
          resourceType: RESOURCE_TYPES.USER,
          resourceId: user.id,
          resourceName: user.username,
          status: 'failed',
          errorMessage: shouldLock ? 'Account locked' : 'Invalid password',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        if (shouldLock) {
          const remainingMins = Math.ceil(LOCKOUT_DURATION_MS / 60000);
          return res.status(423).json({
            message: `Too many failed attempts. Try again in ${remainingMins} minute${remainingMins > 1 ? 's' : ''}.`,
            lockedUntil,
          });
        }

        return res.status(401).json({
          message: 'Invalid username/email or password',
        });
      }

      // Generate tokens
      const accessToken = generateAccessToken(user, rememberMe);
      const refreshToken = generateRefreshToken(user);

      // Store refresh token and reset lockout
      await prisma.user.update({
        where: { id: user.id },
        data: {
          refreshToken,
          lastLoginAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Clear in-memory lockout for this IP+username combination on successful login
      failedAttemptsByIpAndUsername.delete(ipAndUsername);

      logger.info(`User logged in: ${user.username}`);

      // Log activity
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.AUTH_LOGIN,
        resourceType: RESOURCE_TYPES.USER,
        resourceId: user.id,
        resourceName: user.username,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      // Calculate expiry
      const expiresIn = rememberMe ? 30 * 24 * 60 * 60 : 60 * 60; // 30 days or 1 hour

      // Set httpOnly cookies
      res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: expiresIn * 1000,
      });
      res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
        expiresIn,
        // Also return access token for WebSocket authentication
        // (WebSockets can't access httpOnly cookies)
        accessToken,
      });
    } catch (error) {
      logger.error('Login error:', error);
      return res.status(500).json({
        message: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token from cookie
   * Rate limited to prevent abuse
   */
  router.post('/refresh', strictLimiter, async (req: Request, res: Response) => {
    try {
      // Read refresh token from cookie (fallback to body for backwards compatibility)
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] || req.body?.refreshToken;

      if (!refreshToken) {
        return res.status(400).json({
          message: 'Refresh token is required',
        });
      }

      // Verify refresh token
      const payload = verifyRefreshToken(refreshToken);

      if (!payload) {
        // Clear invalid cookies
        res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
        res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
        return res.status(401).json({
          message: 'Invalid or expired refresh token',
        });
      }

      // Find user and verify refresh token matches
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.refreshToken !== refreshToken) {
        // Clear invalid cookies
        res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
        res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
        return res.status(401).json({
          message: 'Invalid refresh token',
        });
      }

      // Generate new tokens
      const newAccessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken(user);

      // Update refresh token
      await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: newRefreshToken },
      });

      logger.debug(`Token refreshed for user: ${user.username}`);

      // Set new cookies
      const expiresIn = 60 * 60; // 1 hour
      res.cookie(ACCESS_TOKEN_COOKIE, newAccessToken, {
        ...COOKIE_OPTIONS,
        maxAge: expiresIn * 1000,
      });
      res.cookie(REFRESH_TOKEN_COOKIE, newRefreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
        expiresIn,
        // Also return access token for WebSocket authentication
        accessToken: newAccessToken,
      });
    } catch (error) {
      logger.error('Token refresh error:', error);
      return res.status(500).json({
        message: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Invalidate refresh token and clear cookies
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      // Read refresh token from cookie (fallback to header for backwards compatibility)
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

      if (refreshToken) {
        // Try to verify and invalidate refresh token
        const payload = verifyRefreshToken(refreshToken);

        if (payload) {
          await prisma.user.update({
            where: { id: payload.sub },
            data: { refreshToken: null },
          });
          logger.info(`User logged out: ${payload.username}`);

          // Log activity
          const activityLogService: ActivityLogService = req.app.get('activityLogService');
          const context = getActivityContext(req);
          activityLogService.logAsync({
            userId: payload.sub,
            username: payload.username,
            userRole: payload.role,
            action: ACTIVITY_ACTIONS.AUTH_LOGOUT,
            resourceType: RESOURCE_TYPES.USER,
            resourceId: payload.sub,
            resourceName: payload.username,
            status: 'success',
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          });
        }
      }

      // Always clear cookies
      res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });

      return res.json({ message: 'Logged out successfully' });
    } catch (error) {
      logger.error('Logout error:', error);
      // Still clear cookies and return success
      res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
      return res.json({ message: 'Logged out successfully' });
    }
  });

  /**
   * PUT /api/auth/password
   * Change password (requires authentication)
   * Rate limited to prevent brute force attacks
   */
  router.put('/password', strictLimiter, async (req: Request, res: Response) => {
    try {
      // Try cookie first, then fall back to Authorization header
      const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const token = cookieToken || headerToken;

      if (!token) {
        return res.status(401).json({
          message: 'Authentication required',
        });
      }

      // Verify access token
      const payload = verifyAccessToken(token);

      if (!payload) {
        return res.status(401).json({
          message: 'Invalid or expired token',
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          message: 'Current password and new password are required',
        });
      }

      const passwordValidation = validatePasswordComplexity(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          message: passwordValidation.message,
        });
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        return res.status(401).json({
          message: 'User not found',
        });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);

      if (!isValidPassword) {
        return res.status(401).json({
          message: 'Current password is incorrect',
        });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      // Update password
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          refreshToken: null, // Invalidate all sessions
        },
      });

      logger.info(`Password changed for user: ${user.username}`);

      // Log activity
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.AUTH_PASSWORD_CHANGE,
        resourceType: RESOURCE_TYPES.USER,
        resourceId: user.id,
        resourceName: user.username,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return res.json({
        message: 'Password changed successfully',
      });
    } catch (error) {
      logger.error('Password change error:', error);
      return res.status(500).json({
        message: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/auth/me
   * Get current user info (requires authentication)
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const token = cookieToken || headerToken;

      if (!token) {
        return res.status(401).json({
          message: 'Authentication required',
        });
      }

      // Verify access token
      const payload = verifyAccessToken(token);

      if (!payload) {
        return res.status(401).json({
          message: 'Invalid or expired token',
        });
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        return res.status(401).json({
          message: 'User not found',
        });
      }

      return res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      });
    } catch (error) {
      logger.error('Get user error:', error);
      return res.status(500).json({
        message: 'Internal server error',
      });
    }
  });

  return router;
}
