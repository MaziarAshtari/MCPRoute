import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { parseMasterKey } from './lib/crypto';
import { DEFAULT_WEB_DIST_DIR } from './paths';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  /** Absolute path, or `:memory:`. */
  databasePath: string;
  masterKey: Buffer;
  adminUsername: string;
  adminPassword: string;
  /** Idle lifetime of MCP sessions (session affinity). */
  sessionTtlMinutes: number;
  logLevel: LogLevel;
  trustProxy: boolean;
  cookieSecure: boolean | 'auto';
  webDistDir: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_DATABASE_PATH = './data/mcproute.db';

// Treat `KEY=` (empty) like an unset variable so defaults apply.
const env = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema);
const flag = z.enum(['true', 'false', '1', '0', 'yes', 'no']).transform((value) => ['true', '1', 'yes'].includes(value));

const envSchema = z.object({
  NODE_ENV: env(z.enum(['development', 'production', 'test']).default('development')),
  HOST: env(z.string().default('127.0.0.1')),
  PORT: env(z.coerce.number().int().min(1).max(65535).default(3000)),
  DATABASE_PATH: env(z.string().default(DEFAULT_DATABASE_PATH)),
  MASTER_KEY: env(z.string({ error: 'MASTER_KEY is required (generate one with `openssl rand -hex 32`)' })),
  ADMIN_USERNAME: env(z.string().trim().min(1).default('admin')),
  ADMIN_PASSWORD: env(
    z.string({ error: 'ADMIN_PASSWORD is required' }).min(8, 'ADMIN_PASSWORD must be at least 8 characters'),
  ),
  SESSION_TTL_MINUTES: env(z.coerce.number().int().min(1).max(43_200).default(60)),
  LOG_LEVEL: env(z.enum(LOG_LEVELS).default('info')),
  TRUST_PROXY: env(flag.default(false)),
  COOKIE_SECURE: env(z.enum(['auto', 'true', 'false']).default('auto')),
  WEB_DIST_DIR: env(z.string().optional()),
});

/**
 * Finds the nearest `.env`, searching from `startDir` up to the workspace root
 * (the directory containing pnpm-workspace.yaml) or the filesystem root.
 */
export function findEnvFile(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || parent === dir) return null;
    dir = parent;
  }
}

/** Loads the nearest `.env` into process.env without overriding variables that are already set. */
export function loadDotEnv(startDir: string = process.cwd()): string | null {
  const file = findEnvFile(startDir);
  if (!file) return null;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
  return file;
}

/** Relative paths are resolved against `baseDir` (the directory of the loaded `.env`, else the cwd). */
export function resolveDatabasePath(value: string, baseDir: string): string {
  if (value === ':memory:' || isAbsolute(value)) return value;
  return resolve(baseDir, value);
}

export function parseConfig(source: Record<string, string | undefined>, baseDir: string): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.map(String).join('.');
        return issue.message.startsWith(name) ? issue.message : `${name}: ${issue.message}`;
      }),
    );
  }
  const values = result.data;

  let masterKey: Buffer;
  try {
    masterKey = parseMasterKey(values.MASTER_KEY);
  } catch (error) {
    throw new ConfigError([(error as Error).message]);
  }

  return {
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    databasePath: resolveDatabasePath(values.DATABASE_PATH, baseDir),
    masterKey,
    adminUsername: values.ADMIN_USERNAME,
    adminPassword: values.ADMIN_PASSWORD,
    sessionTtlMinutes: values.SESSION_TTL_MINUTES,
    logLevel: values.LOG_LEVEL,
    trustProxy: values.TRUST_PROXY,
    cookieSecure: values.COOKIE_SECURE === 'auto' ? 'auto' : values.COOKIE_SECURE === 'true',
    webDistDir: values.WEB_DIST_DIR ? resolve(baseDir, values.WEB_DIST_DIR) : DEFAULT_WEB_DIST_DIR,
  };
}

/** Loads `.env` (if any) and validates the environment. Throws ConfigError with readable problems. */
export function loadConfig(cwd: string = process.cwd()): AppConfig {
  const envFile = loadDotEnv(cwd);
  return parseConfig(process.env, envFile ? dirname(envFile) : cwd);
}

/** Database location only; used by the migration CLI, which needs no other settings. */
export function loadDatabasePath(cwd: string = process.cwd()): string {
  const envFile = loadDotEnv(cwd);
  const value = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  return resolveDatabasePath(value, envFile ? dirname(envFile) : cwd);
}
