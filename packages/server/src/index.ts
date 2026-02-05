import { App } from './app';
import logger from './utils/logger';
import fs from 'fs';
import path from 'path';

// Enable BigInt JSON serialization (required for Prisma BigInt fields like fileSize)
// BigInt values are converted to numbers for JSON - safe for file sizes up to ~9 petabytes
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create app instance
const app = new App();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await app.shutdown();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await app.shutdown();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason instanceof Error ? reason : String(reason));
  process.exit(1);
});

// Start the server
app.start().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});
