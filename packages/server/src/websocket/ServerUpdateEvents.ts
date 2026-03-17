import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { serverUpdateService } from '../services/ServerUpdateService';
import logger from '../utils/logger';


// Read JWT_SECRET lazily to ensure dotenv has loaded
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET not configured!');
    return '';
  }
  return secret;
}

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export class ServerUpdateEvents {
  private io: SocketServer;

  constructor(io: SocketServer) {
    this.io = io;
  }

  /**
   * Initialize server-updates WebSocket namespace
   */
  initialize(): void {
    const namespace = this.io.of('/server-updates');

    // SECURITY: WebSocket authentication middleware
    namespace.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          logger.warn(`[ServerUpdate WS] Connection rejected: No token (${socket.id})`);
          return next(new Error('Authentication required'));
        }

        const jwtSecret = getJwtSecret();
        if (!jwtSecret) {
          logger.error('[ServerUpdate WS] JWT_SECRET not configured');
          return next(new Error('Server configuration error'));
        }

        // Verify the JWT token
        const payload = jwt.verify(token, jwtSecret) as { sub: string; username: string; role: string; type: string };

        if (payload.type !== 'access') {
          logger.warn(`[ServerUpdate WS] Connection rejected: Invalid token type (${socket.id})`);
          return next(new Error('Invalid token type'));
        }

        // Verify user still exists
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, username: true, role: true },
        });

        if (!user) {
          logger.warn(`[ServerUpdate WS] Connection rejected: User not found (${socket.id})`);
          return next(new Error('User not found'));
        }

        // Attach user to socket
        socket.user = user;
        logger.info(`[ServerUpdate WS] Authenticated: ${user.username} (${socket.id})`);
        next();
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          logger.warn(`[ServerUpdate WS] Connection rejected: Token expired (${socket.id})`);
          return next(new Error('Token expired'));
        }
        logger.warn(`[ServerUpdate WS] Connection rejected: Invalid token (${socket.id})`);
        return next(new Error('Invalid token'));
      }
    });

    // Handle connections
    namespace.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`[ServerUpdate WS] Client connected: ${socket.id} (user: ${socket.user?.username})`);

      // Subscribe to a specific server's update events
      socket.on('subscribe', (data: { serverId: string }) => {
        if (data.serverId) {
          socket.join(`server-update:${data.serverId}`);
          logger.info(`[ServerUpdate WS] Client ${socket.id} subscribed to server ${data.serverId}`);
        } else {
          // Subscribe to all server updates
          socket.join('server-updates-all');
          logger.info(`[ServerUpdate WS] Client ${socket.id} subscribed to all server updates`);
        }
      });

      // Unsubscribe from events
      socket.on('unsubscribe', (data: { serverId?: string }) => {
        if (data.serverId) {
          socket.leave(`server-update:${data.serverId}`);
          logger.info(`[ServerUpdate WS] Client ${socket.id} unsubscribed from server ${data.serverId}`);
        } else {
          socket.leave('server-updates-all');
          logger.info(`[ServerUpdate WS] Client ${socket.id} unsubscribed from all server updates`);
        }
      });

      socket.on('disconnect', () => {
        logger.info(`[ServerUpdate WS] Client disconnected: ${socket.id}`);
      });
    });

    // Forward service events to WebSocket clients
    this.setupServiceEventForwarding(namespace);

    logger.info('[ServerUpdate WS] Events initialized');
  }

  /**
   * Forward ServerUpdateService events to WebSocket clients
   */
  private setupServiceEventForwarding(namespace: ReturnType<SocketServer['of']>): void {
    // Update started
    serverUpdateService.on('update:started', (data) => {
      logger.info(`[ServerUpdate WS] Forwarding update:started event for server ${data.serverId}`);
      namespace.to(`server-update:${data.serverId}`).emit('update:started', data);
      namespace.to('server-updates-all').emit('update:started', data);
    });

    // Update progress
    serverUpdateService.on('update:progress', (data) => {
      namespace.to(`server-update:${data.serverId}`).emit('update:progress', data);
      namespace.to('server-updates-all').emit('update:progress', data);
    });

    // Update completed
    serverUpdateService.on('update:completed', (data) => {
      logger.info(`[ServerUpdate WS] Forwarding update:completed event for server ${data.serverId}`);
      namespace.to(`server-update:${data.serverId}`).emit('update:completed', data);
      namespace.to('server-updates-all').emit('update:completed', data);
    });

    // Update failed
    serverUpdateService.on('update:failed', (data) => {
      logger.warn(`[ServerUpdate WS] Forwarding update:failed event for server ${data.serverId}: ${data.error}`);
      namespace.to(`server-update:${data.serverId}`).emit('update:failed', data);
      namespace.to('server-updates-all').emit('update:failed', data);
    });

    // Update cancelled
    serverUpdateService.on('update:cancelled', (data) => {
      logger.info(`[ServerUpdate WS] Forwarding update:cancelled event for server ${data.serverId}`);
      namespace.to(`server-update:${data.serverId}`).emit('update:cancelled', data);
      namespace.to('server-updates-all').emit('update:cancelled', data);
    });

    // Rollback completed
    serverUpdateService.on('update:rollback-completed', (data) => {
      logger.info(`[ServerUpdate WS] Forwarding update:rollback-completed event for server ${data.serverId}`);
      namespace.to(`server-update:${data.serverId}`).emit('update:rollback-completed', data);
      namespace.to('server-updates-all').emit('update:rollback-completed', data);
    });

    // Updates available from auto-check
    serverUpdateService.on('updates:available', (data) => {
      logger.info(`[ServerUpdate WS] Forwarding updates:available event (${data.servers.length} servers)`);
      namespace.to('server-updates-all').emit('updates:available', data);
    });
  }
}
