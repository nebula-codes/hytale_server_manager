import { PrismaClient } from '@prisma/client';

/**
 * Shared PrismaClient singleton.
 * Import this instead of creating a new PrismaClient() in each file.
 * Having a single instance avoids SQLite "database is locked" errors
 * that occur when multiple connection pools try to write concurrently.
 */
const prisma = new PrismaClient();

export default prisma;
