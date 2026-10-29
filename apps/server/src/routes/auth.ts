import { loginSchema } from '@mcproute/shared';
import type { FastifyPluginAsync } from 'fastify';
import { clearAdminSession, issueAdminSession } from '../auth';
import type { AppContext } from '../context';
import { safeEqual } from '../lib/crypto';
import { HttpError } from '../lib/errors';

export function authRoutes({ config }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post('/auth/login', async (request, reply) => {
      const { username, password } = loginSchema.parse(request.body);
      // Evaluate both comparisons so the response time does not reveal which one failed.
      const usernameOk = safeEqual(username, config.adminUsername);
      const passwordOk = safeEqual(password, config.adminPassword);
      if (!usernameOk || !passwordOk) {
        request.log.warn({ ip: request.ip }, 'Failed admin login');
        throw new HttpError(401, 'Invalid username or password');
      }
      request.log.info({ ip: request.ip }, 'Admin logged in');
      return issueAdminSession(reply, config);
    });

    app.post('/auth/logout', async (_request, reply) => {
      clearAdminSession(reply);
      return reply.code(204).send();
    });

    app.get('/auth/me', async (request) => request.admin);
  };
}
