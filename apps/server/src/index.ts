import { buildApp } from './app';
import { ConfigError, loadConfig, type AppConfig } from './config';
import { openDatabase, runMigrations } from './db/client';
import { createLogger } from './logger';

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Printed directly: the logger is configured from this very config.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel, pretty: config.nodeEnv === 'development' });
  const database = openDatabase(config.databasePath);
  runMigrations(database.db);
  logger.info({ databasePath: config.databasePath }, 'Database ready');

  const app = await buildApp({ config, database, logger });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    try {
      await app.close();
    } finally {
      database.close();
      process.exit(0);
    }
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
