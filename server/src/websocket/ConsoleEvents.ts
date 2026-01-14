import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ServerService } from '../services/ServerService';
import { ConsoleService } from '../services/ConsoleService';
import logger from '../utils/logger';
import { LogEntry } from '../types';

const prisma = new PrismaClient();

// Read JWT_SECRET lazily to ensure dotenv has loaded
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  logger.info(`[ConsoleEvents] getJwtSecret called - JWT_SECRET: ${secret ? 'present (length: ' + secret.length + ')' : 'MISSING'}`);
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

export class ConsoleEvents {
  private io: SocketServer;
  private serverService: ServerService;
  private consoleService: ConsoleService;
  private logStreams: Map<string, Set<string>> = new Map(); // serverId -> Set of socket IDs

  constructor(io: SocketServer, serverService: ServerService, consoleService: ConsoleService) {
    this.io = io;
    this.serverService = serverService;
    this.consoleService = consoleService;
  }

  /**
   * Initialize console events namespace
   */
  initialize(): void {
    const consoleNamespace = this.io.of('/console');

    // SECURITY: WebSocket authentication middleware
    consoleNamespace.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        // DEBUG: Log received token
        logger.info(`[ConsoleEvents DEBUG] Token received: ${token ? token.substring(0, 50) + '...' : 'NONE'}`);

        if (!token) {
          logger.warn(`WebSocket connection rejected: No token provided (${socket.id})`);
          return next(new Error('Authentication required'));
        }

        const jwtSecret = getJwtSecret();

        // DEBUG: Log secret info
        logger.info(`[ConsoleEvents DEBUG] Secret first 10 chars: ${jwtSecret?.substring(0, 10)}`);

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

    consoleNamespace.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`Client connected to /console: ${socket.id} (user: ${socket.user?.username})`);

      // Subscribe to console logs for a server
      socket.on('subscribe', async (data: { serverId: string }) => {
        const { serverId } = data;
        logger.info(`[ConsoleEvents] Client ${socket.id} subscribing to console for server ${serverId}`);

        // Join room for this server
        socket.join(`console:${serverId}`);

        try {
          // Get the adapter
          const adapter = await this.serverService.getAdapterForServer(serverId);
          logger.info(`[ConsoleEvents] Got adapter for ${serverId}, existing stream: ${this.logStreams.has(serverId)}`);

          // Track this subscription - always re-register the callback to ensure it's on the right adapter
          if (!this.logStreams.has(serverId)) {
            this.logStreams.set(serverId, new Set());
          }

          // Always set up log streaming (in case adapter was recreated)
          const logHandler = async (log: LogEntry) => {
            logger.debug(`[ConsoleEvents] Emitting log to console:${serverId}`);
            // Emit log to all subscribed clients
            consoleNamespace.to(`console:${serverId}`).emit('log', {
              serverId,
              log,
            });

            // Save log to database
            await this.consoleService.saveLog(serverId, log);
          };

          this.consoleService.streamLogs(adapter, logHandler);
          logger.info(`[ConsoleEvents] Registered log handler for ${serverId}`);

          this.logStreams.get(serverId)!.add(socket.id);

          // Send recent historical logs
          const recentLogs = await this.consoleService.getLogs(serverId, 50);
          logger.info(`[ConsoleEvents] Sending ${recentLogs.length} historical logs to ${socket.id}`);
          socket.emit('logs:history', {
            serverId,
            logs: recentLogs,
          });
        } catch (error) {
          logger.error(`[ConsoleEvents] Error subscribing to console for server ${serverId}:`, error);
          socket.emit('error', { message: 'Failed to subscribe to console' });
        }
      });

      // Send a command to the server
      socket.on('command', async (data: { serverId: string; command: string }) => {
        const { serverId, command } = data;
        logger.info(`Client ${socket.id} sending command to server ${serverId}: ${command}`);

        try {
          const adapter = await this.serverService.getAdapterForServer(serverId);
          const response = await this.consoleService.sendCommand(adapter, command);

          socket.emit('commandResponse', {
            serverId,
            command,
            response,
          });

          // Broadcast the command to all subscribed clients (for transparency)
          consoleNamespace.to(`console:${serverId}`).emit('log', {
            serverId,
            log: {
              timestamp: new Date(),
              level: 'info',
              message: `> ${command}`,
              source: 'user',
            },
          });

          // Emit the response as a log
          consoleNamespace.to(`console:${serverId}`).emit('log', {
            serverId,
            log: {
              timestamp: response.executedAt,
              level: response.success ? 'info' : 'error',
              message: response.output,
              source: 'server',
            },
          });
        } catch (error) {
          logger.error(`Error sending command to server ${serverId}:`, error);
          socket.emit('error', { message: 'Failed to send command' });
        }
      });

      // Unsubscribe from console logs
      socket.on('unsubscribe', async (data: { serverId: string }) => {
        const { serverId } = data;
        logger.info(`Client ${socket.id} unsubscribing from console for server ${serverId}`);

        socket.leave(`console:${serverId}`);

        // Remove from tracking
        const subscribers = this.logStreams.get(serverId);
        if (subscribers) {
          subscribers.delete(socket.id);

          // If no more subscribers, stop streaming from adapter
          if (subscribers.size === 0) {
            try {
              const adapter = await this.serverService.getAdapterForServer(serverId);
              this.consoleService.stopStreamLogs(adapter);
              this.logStreams.delete(serverId);
              logger.info(`Stopped log streaming for server ${serverId}`);
            } catch (error) {
              logger.error(`Error stopping log stream for server ${serverId}:`, error);
            }
          }
        }
      });

      socket.on('disconnect', async () => {
        logger.info(`Client disconnected from /console: ${socket.id}`);

        // Clean up any subscriptions for this socket
        for (const [serverId, subscribers] of this.logStreams.entries()) {
          if (subscribers.has(socket.id)) {
            subscribers.delete(socket.id);

            if (subscribers.size === 0) {
              try {
                const adapter = await this.serverService.getAdapterForServer(serverId);
                this.consoleService.stopStreamLogs(adapter);
                this.logStreams.delete(serverId);
                logger.info(`Stopped log streaming for server ${serverId}`);
              } catch (error) {
                logger.error(`Error stopping log stream for server ${serverId}:`, error);
              }
            }
          }
        }
      });
    });

    logger.info('Console events initialized');
  }

  /**
   * Cleanup - stop all log streams
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up console events...');

    for (const serverId of this.logStreams.keys()) {
      try {
        const adapter = await this.serverService.getAdapterForServer(serverId);
        this.consoleService.stopStreamLogs(adapter);
        logger.info(`Stopped log streaming for server ${serverId}`);
      } catch (error) {
        logger.error(`Error stopping log stream for server ${serverId}:`, error);
      }
    }

    this.logStreams.clear();
  }
}
