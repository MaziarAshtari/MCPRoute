import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { parseConfig, type AppConfig } from '../src/config';
import { openDatabase, runMigrations, type DatabaseHandle } from '../src/db/client';
import { createLogger } from '../src/logger';

export const ADMIN = { username: 'admin', password: 'correct-horse-battery-staple' };
export const TEST_MASTER_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export interface TestContext {
  app: FastifyInstance;
  config: AppConfig;
  database: DatabaseHandle;
  /** Every line written by the server logger (level trace). */
  logs: string[];
  /** Authenticated request helper. */
  api: (method: InjectOptions['method'], url: string, payload?: unknown) => Promise<ApiResponse>;
  close: () => Promise<void>;
}

export interface ApiResponse {
  statusCode: number;
  body: string;
  /** Parsed JSON body; typed loosely because tests assert its shape structurally. */
  json: any;
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const config = parseConfig(
    {
      NODE_ENV: 'test',
      MASTER_KEY: TEST_MASTER_KEY,
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      DATABASE_PATH: ':memory:',
      WEB_DIST_DIR: '/nonexistent-web-dist',
      ...env,
    },
    process.cwd(),
  );
  const database = openDatabase(config.databasePath);
  runMigrations(database.db);

  const logs: string[] = [];
  const logger = createLogger({ level: 'trace' }, { write: (line: string) => void logs.push(line) });
  const app = await buildApp({ config, database, logger });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: config.adminUsername, password: config.adminPassword },
  });
  const session = login.cookies.find((cookie) => cookie.name === 'mcproute_session');
  if (login.statusCode !== 200 || !session) throw new Error(`Test login failed: ${login.statusCode} ${login.body}`);

  const api: TestContext['api'] = async (method, url, payload) => {
    const response = await app.inject({
      method,
      url,
      cookies: { mcproute_session: session.value },
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
    return {
      statusCode: response.statusCode,
      body: response.body,
      json: response.body ? JSON.parse(response.body) : undefined,
    };
  };

  return {
    app,
    config,
    database,
    logs,
    api,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

export const exaProvider = {
  name: 'Exa Search',
  transport: 'streamable_http',
  url: 'https://mcp.exa.ai/mcp?exaApiKey={{API_KEY}}',
};
