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

/** MCP clients that cannot set headers pass the endpoint token as `?token=`; it must never reach the logs. */
export function redactUrlSecrets(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');
}

interface LoggableRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/** Same fields as Fastify's default `req` serializer, with secrets removed from the URL. */
function serializeRequest(req: LoggableRequest) {
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactUrlSecrets(req.url) : req.url,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

export function createLogger(settings: LoggerSettings, destination?: pino.DestinationStream): Logger {
  const options: LoggerOptions = {
    level: settings.level,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // Fastify merges these over its own serializers when given a logger instance.
    serializers: { req: serializeRequest },
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
