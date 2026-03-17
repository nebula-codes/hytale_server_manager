import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { hytaleDownloaderService } from '../services/HytaleDownloaderService';
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

export class HytaleDownloaderEvents {
  private io: SocketServer;

  constructor(io: SocketServer) {
    this.io = io;
  }

  /**
   * Initialize hytale-downloader WebSocket namespace
   */
  initialize(): void {
    const namespace = this.io.of('/hytale-downloader');

    // SECURITY: WebSocket authentication middleware
    namespace.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          logger.warn(`[HytaleDownloader WS] Connection rejected: No token (${socket.id})`);
          return next(new Error('Authentication required'));
        }

        const jwtSecret = getJwtSecret();
        if (!jwtSecret) {
          logger.error('[HytaleDownloader WS] JWT_SECRET not configured');
          return next(new Error('Server configuration error'));
        }

        // Verify the JWT token
        const payload = jwt.verify(token, jwtSecret) as { sub: string; username: string; role: string; type: string };

        if (payload.type !== 'access') {
          logger.warn(`[HytaleDownloader WS] Connection rejected: Invalid token type (${socket.id})`);
          return next(new Error('Invalid token type'));
        }

        // Verify user still exists
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, username: true, role: true },
        });

        if (!user) {
          logger.warn(`[HytaleDownloader WS] Connection rejected: User not found (${socket.id})`);
          return next(new Error('User not found'));
        }

        // Attach user to socket
        socket.user = user;
        logger.info(`[HytaleDownloader WS] Authenticated: ${user.username} (${socket.id})`);
        next();
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          logger.warn(`[HytaleDownloader WS] Connection rejected: Token expired (${socket.id})`);
          return next(new Error('Token expired'));
        }
        logger.warn(`[HytaleDownloader WS] Connection rejected: Invalid token (${socket.id})`);
        return next(new Error('Invalid token'));
      }
    });

    // Handle connections
    namespace.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`[HytaleDownloader WS] Client connected: ${socket.id} (user: ${socket.user?.username})`);

      // Subscribe to events
      socket.on('subscribe', () => {
        socket.join('hytale-downloader');
        logger.info(`[HytaleDownloader WS] Client ${socket.id} subscribed to events`);
      });

      // Unsubscribe from events
      socket.on('unsubscribe', () => {
        socket.leave('hytale-downloader');
        logger.info(`[HytaleDownloader WS] Client ${socket.id} unsubscribed from events`);
      });

      socket.on('disconnect', () => {
        logger.info(`[HytaleDownloader WS] Client disconnected: ${socket.id}`);
      });
    });

    // Forward service events to WebSocket clients
    this.setupServiceEventForwarding(namespace);

    logger.info('[HytaleDownloader WS] Events initialized');
  }

  /**
   * Forward HytaleDownloaderService events to WebSocket clients
   */
  private setupServiceEventForwarding(namespace: ReturnType<SocketServer['of']>): void {
    // OAuth device code received
    hytaleDownloaderService.on('oauth:device-code', (data) => {
      logger.debug('[HytaleDownloader WS] Forwarding oauth:device-code event');
      namespace.to('hytale-downloader').emit('oauth:device-code', data);
    });

    // OAuth status update
    hytaleDownloaderService.on('oauth:status', (data) => {
      logger.debug('[HytaleDownloader WS] Forwarding oauth:status event:', data.status);
      namespace.to('hytale-downloader').emit('oauth:status', data);
    });

    // Download progress
    hytaleDownloaderService.on('download:progress', (data) => {
      namespace.to('hytale-downloader').emit('download:progress', data);
    });

    // Download complete
    hytaleDownloaderService.on('download:complete', (data) => {
      logger.info('[HytaleDownloader WS] Forwarding download:complete event');
      namespace.to('hytale-downloader').emit('download:complete', data);
    });

    // Download error
    hytaleDownloaderService.on('download:error', (data) => {
      logger.warn('[HytaleDownloader WS] Forwarding download:error event:', data.error);
      namespace.to('hytale-downloader').emit('download:error', data);
    });
  }
}
