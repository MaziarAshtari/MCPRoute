import fastifyCookie from '@fastify/cookie';
import type { HealthDto } from '@mcproute/shared';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import { cookieSigningSecret, registerAdminAuth } from './auth';
import type { AppConfig } from './config';
import type { AppContext } from './context';
import type { DatabaseHandle } from './db/client';
import { SecretBox } from './lib/crypto';
import { HttpError, errorBody } from './lib/errors';
import { createLogger } from './logger';
import { authRoutes } from './routes/auth';
import { endpointRoutes } from './routes/endpoints';
import { keyRoutes } from './routes/keys';
import { logRoutes } from './routes/logs';
import { providerRoutes } from './routes/providers';
import { proxyRoutes } from './routes/proxies';
import { sessionRoutes } from './routes/sessions';
import { registerWebUi } from './web';

export interface BuildAppOptions {
  config: AppConfig;
  database: DatabaseHandle;
  logger?: FastifyBaseLogger;
}

function handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    // Issues carry only paths and messages, never the submitted values.
    return reply.code(400).send({
      ...errorBody(400, 'Validation failed'),
      issues: error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    });
  }
  if (error instanceof HttpError) return reply.code(error.statusCode).send(errorBody(error.statusCode, error.message));
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return reply.code(409).send(errorBody(409, 'A resource with the same unique value already exists'));
  }

  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send(errorBody(statusCode, error.message));
  request.log.error({ err: error }, 'Unhandled error');
  return reply.code(500).send(errorBody(500, 'Internal Server Error'));
}

export async function buildApp({ config, database, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger ?? createLogger({ level: config.logLevel, pretty: config.nodeEnv === 'development' }),
    trustProxy: config.trustProxy,
  });
  const ctx: AppContext = { config, db: database.db, secrets: new SecretBox(config.masterKey) };

  app.setErrorHandler(handleError);
  await app.register(fastifyCookie, { secret: cookieSigningSecret(config) });
  registerAdminAuth(app, config);

  app.get('/healthz', async (): Promise<HealthDto> => {
    database.sqlite.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  await app.register(
    async (api) => {
      for (const routes of [authRoutes, providerRoutes, keyRoutes, proxyRoutes, endpointRoutes, logRoutes, sessionRoutes]) {
        await api.register(routes(ctx));
      }
    },
    { prefix: '/api' },
  );

  await registerWebUi(app, config.webDistDir);
  return app;
}
