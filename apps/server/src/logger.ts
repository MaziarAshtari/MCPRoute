import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Defense in depth: plaintext API keys, proxy credentials, passwords and tokens are never
 * passed to the logger, but these paths are censored in case one slips through.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'key',
  '*.key',
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'accessToken',
  '*.accessToken',
  'masterKey',
  '*.masterKey',
  'proxyUrl',
  '*.proxyUrl',
];

export interface LoggerSettings {
  level: string;
  /** Human-readable output via pino-pretty (development only; it is a dev dependency). */
  pretty?: boolean;
  name?: string;
}

export function createLogger(settings: LoggerSettings, destination?: pino.DestinationStream): Logger {
  const options: LoggerOptions = {
    level: settings.level,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  };
  if (settings.name) options.name = settings.name;
  if (settings.pretty && !destination) {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    };
  }
  return destination ? pino(options, destination) : pino(options);
}
