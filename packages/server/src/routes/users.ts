import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger';
import { AuthenticatedRequest, authorize } from '../middleware/auth';


/**
 * Create user management routes
 * All routes require admin role
 */
export function createUserRoutes(): Router {
  const router = Router();

  // All user management routes require admin role
  router.use(authorize('admin'));

  /**
   * GET /api/users
   * Get all users
   */
  router.get('/', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(users);
    } catch (error) {
      logger.error('Error fetching users:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * GET /api/users/:id
   * Get user by ID
   */
  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.json(user);
    } catch (error) {
      logger.error('Error fetching user:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * POST /api/users
   * Create new user
   */
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, username, password, role } = req.body;

      // Validate required fields
      if (!email || !username || !password) {
        return res.status(400).json({
          message: 'Email, username, and password are required',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      // Validate username
      if (username.length < 3 || username.length > 32) {
        return res.status(400).json({
          message: 'Username must be between 3 and 32 characters',
        });
      }

      // Validate password
      if (password.length < 8) {
        return res.status(400).json({
          message: 'Password must be at least 8 characters',
        });
      }

      // Validate role
      const validRoles = ['admin', 'moderator', 'viewer'];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({
          message: 'Invalid role. Must be admin, moderator, or viewer',
        });
      }

      // Check if email or username already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: email.toLowerCase() },
            { username: username.toLowerCase() },
          ],
        },
      });

      if (existingUser) {
        if (existingUser.email === email.toLowerCase()) {
          return res.status(409).json({ message: 'Email already in use' });
        }
        return res.status(409).json({ message: 'Username already in use' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          username: username.toLowerCase(),
          passwordHash,
          role: role || 'viewer',
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
        },
      });

      logger.info(`User created: ${user.username} by ${req.user?.username}`);

      return res.status(201).json(user);
    } catch (error) {
      logger.error('Error creating user:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/users/:id
   * Update user
   */
  router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { email, username, password, role } = req.body;

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Build update data
      const updateData: {
        email?: string;
        username?: string;
        passwordHash?: string;
        role?: string;
      } = {};

      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if email already in use by another user
        const emailExists = await prisma.user.findFirst({
          where: {
            email: email.toLowerCase(),
            NOT: { id },
          },
        });
        if (emailExists) {
          return res.status(409).json({ message: 'Email already in use' });
        }

        updateData.email = email.toLowerCase();
      }

      if (username) {
        if (username.length < 3 || username.length > 32) {
          return res.status(400).json({
            message: 'Username must be between 3 and 32 characters',
          });
        }

        // Check if username already in use by another user
        const usernameExists = await prisma.user.findFirst({
          where: {
            username: username.toLowerCase(),
            NOT: { id },
          },
        });
        if (usernameExists) {
          return res.status(409).json({ message: 'Username already in use' });
        }

        updateData.username = username.toLowerCase();
      }

      if (password) {
        if (password.length < 8) {
          return res.status(400).json({
            message: 'Password must be at least 8 characters',
          });
        }
        updateData.passwordHash = await bcrypt.hash(password, 12);
      }

      if (role) {
        const validRoles = ['admin', 'moderator', 'viewer'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({
            message: 'Invalid role. Must be admin, moderator, or viewer',
          });
        }
        updateData.role = role;
      }

      // Update user
      const user = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      logger.info(`User updated: ${user.username} by ${req.user?.username}`);

      return res.json(user);
    } catch (error) {
      logger.error('Error updating user:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/users/:id
   * Delete user
   */
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      // Prevent self-deletion
      if (req.user?.id === id) {
        return res.status(400).json({
          message: 'Cannot delete your own account',
        });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Check if this is the last admin
      if (existingUser.role === 'admin') {
        const adminCount = await prisma.user.count({
          where: { role: 'admin' },
        });
        if (adminCount <= 1) {
          return res.status(400).json({
            message: 'Cannot delete the last admin user',
          });
        }
      }

      await prisma.user.delete({
        where: { id },
      });

      logger.info(`User deleted: ${existingUser.username} by ${req.user?.username}`);

      return res.json({ message: 'User deleted successfully' });
    } catch (error) {
      logger.error('Error deleting user:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
}
