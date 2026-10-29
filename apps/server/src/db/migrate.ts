import { loadDatabasePath } from '../config';
import { createLogger } from '../logger';
import { openDatabase, runMigrations } from './client';

// `pnpm db:migrate` (dev) or `node dist/migrate.js` (production). The server also migrates on start.
const logger = createLogger({ level: 'info', pretty: process.env.NODE_ENV !== 'production', name: 'migrate' });
const databasePath = loadDatabasePath();
const database = openDatabase(databasePath);

try {
  runMigrations(database.db);
  logger.info({ databasePath }, 'Database migrations applied');
} catch (error) {
  logger.error({ err: error, databasePath }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  database.close();
}
