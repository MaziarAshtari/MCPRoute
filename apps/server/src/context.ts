import type { AppConfig } from './config';
import type { AppDatabase } from './db/client';
import type { Gateway } from './gateway/gateway';
import type { SecretBox } from './lib/crypto';

/** Dependencies shared by all route plugins. */
export interface AppContext {
  config: AppConfig;
  db: AppDatabase;
  secrets: SecretBox;
  gateway: Gateway;
}
