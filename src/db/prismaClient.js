import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn', (e) => logger.warn(e.message));
prisma.$on('error', (e) => logger.error(e.message));

export default prisma;
