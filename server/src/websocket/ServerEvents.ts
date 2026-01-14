import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ServerService } from '../services/ServerService';
import { ConsoleService } from '../services/ConsoleService';
import logger from '../utils/logger';

const prisma = new PrismaClient();

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

export class ServerEvents {
  private io: SocketServer;
  private serverService: ServerService;
  private metricsIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(io: SocketServer, serverService: ServerService, _consoleService: ConsoleService) {
    this.io = io;
    this.serverService = serverService;
  }

  /**
   * Initialize server events namespace
   */
  initialize(): void {
    const serversNamespace = this.io.of('/servers');

    // SECURITY: WebSocket authentication middleware
    serversNamespace.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        // DEBUG: Log received token
        logger.info(`[ServerEvents DEBUG] Token received: ${token ? token.substring(0, 50) + '...' : 'NONE'}`);

        if (!token) {
          logger.warn(`WebSocket connection rejected: No token provided (${socket.id})`);
          return next(new Error('Authentication required'));
        }

        const jwtSecret = getJwtSecret();

        // DEBUG: Log secret info
        logger.info(`[ServerEvents DEBUG] Secret first 10 chars: ${jwtSecret?.substring(0, 10)}`);

        if (!jwtSecret) {
          logger.error('JWT_SECRET not configured for WebSocket authentication');
          return next(new Error('Server configuration error'));
        }

        // Verify the JWT token
        const payload = jwt.verify(token, jwtSecret) as { sub: string; username: string; role: string; type: string };

        if (payload.type !== 'access') {
          logger.warn(`WebSocket connection rejected: Invalid token type (${socket.id})`);
          return next(new Error('Invalid token type'));
        }

        // Verify user still exists
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, username: true, role: true },
        });

        if (!user) {
          logger.warn(`WebSocket connection rejected: User not found (${socket.id})`);
          return next(new Error('User not found'));
        }

        // Attach user to socket
        socket.user = user;
        logger.info(`WebSocket authenticated: ${user.username} (${socket.id})`);
        next();
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          logger.warn(`WebSocket connection rejected: Token expired (${socket.id})`);
          return next(new Error('Token expired'));
        }
        logger.warn(`WebSocket connection rejected: Invalid token (${socket.id})`);
        return next(new Error('Invalid token'));
      }
    });

    serversNamespace.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`Client connected to /servers: ${socket.id} (user: ${socket.user?.username})`);

      // Subscribe to a server's updates
      socket.on('subscribe', async (data: { serverId: string }) => {
        const { serverId } = data;
        logger.info(`Client ${socket.id} subscribing to server ${serverId}`);

        // Join room for this server
        socket.join(`server:${serverId}`);

        try {
          // Send initial status
          const status = await this.serverService.getServerStatus(serverId);
          socket.emit('server:status', { serverId, status });

          // Send initial metrics
          const metrics = await this.serverService.getServerMetrics(serverId);
          socket.emit('server:metrics', { serverId, metrics });

          // Start sending periodic metrics updates
          this.startMetricsUpdates(serverId);
        } catch (error) {
          logger.error(`Error subscribing to server ${serverId}:`, error);
          socket.emit('error', { message: 'Failed to subscribe to server' });
        }
      });

      // Unsubscribe from a server's updates
      socket.on('unsubscribe', (data: { serverId: string }) => {
        const { serverId } = data;
        logger.info(`Client ${socket.id} unsubscribing from server ${serverId}`);
        socket.leave(`server:${serverId}`);

        // Check if any clients are still subscribed to this server
        const room = serversNamespace.adapter.rooms.get(`server:${serverId}`);
        if (!room || room.size === 0) {
          // Stop metrics updates if no clients are subscribed
          this.stopMetricsUpdates(serverId);
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected from /servers: ${socket.id}`);
      });
    });

    logger.info('Server events initialized');
  }

  /**
   * Start sending periodic metrics updates for a server
   */
  private startMetricsUpdates(serverId: string): void {
    // Don't start if already running
    if (this.metricsIntervals.has(serverId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const metrics = await this.serverService.getServerMetrics(serverId);
        const status = await this.serverService.getServerStatus(serverId);

        this.io.of('/servers').to(`server:${serverId}`).emit('server:metrics', {
          serverId,
          metrics,
        });

        this.io.of('/servers').to(`server:${serverId}`).emit('server:status', {
          serverId,
          status,
        });
      } catch (error) {
        logger.error(`Error sending metrics for server ${serverId}:`, error);
      }
    }, 2000); // Update every 2 seconds

    this.metricsIntervals.set(serverId, interval);
    logger.info(`Started metrics updates for server ${serverId}`);
  }

  /**
   * Stop sending metrics updates for a server
   */
  private stopMetricsUpdates(serverId: string): void {
    const interval = this.metricsIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.metricsIntervals.delete(serverId);
      logger.info(`Stopped metrics updates for server ${serverId}`);
    }
  }

  /**
   * Broadcast server status change
   */
  async broadcastStatusChange(serverId: string): Promise<void> {
    try {
      const status = await this.serverService.getServerStatus(serverId);
      this.io.of('/servers').to(`server:${serverId}`).emit('server:status', {
        serverId,
        status,
      });
    } catch (error) {
      logger.error(`Error broadcasting status for server ${serverId}:`, error);
    }
  }

  /**
   * Cleanup - stop all metrics intervals
   */
  cleanup(): void {
    logger.info('Cleaning up server events...');
    for (const [serverId, interval] of this.metricsIntervals.entries()) {
      clearInterval(interval);
      logger.info(`Stopped metrics updates for server ${serverId}`);
    }
    this.metricsIntervals.clear();
  }
}
