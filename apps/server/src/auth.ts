import type { AdminSessionDto } from '@mcproute/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config';
import { deriveKey, sha256Hex } from './lib/crypto';
import { errorBody } from './lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the admin auth hook on authenticated /api requests. */
    admin: AdminSessionDto | null;
  }
}

export const SESSION_COOKIE = 'mcproute_session';
export const ADMIN_SESSION_TTL_SECONDS = 24 * 60 * 60;
const PUBLIC_API_ROUTES = new Set(['POST /api/auth/login']);

interface SessionPayload {
  sub: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/**
 * Cookie signing secret, derived from MASTER_KEY and bound to the admin credentials:
 * changing ADMIN_USERNAME, ADMIN_PASSWORD or MASTER_KEY invalidates existing sessions.
 */
export function cookieSigningSecret(config: AppConfig): Buffer {
  return deriveKey(config.masterKey, `admin-session:${config.adminUsername}:${sha256Hex(config.adminPassword)}`);
}

export function issueAdminSession(reply: FastifyReply, config: AppConfig): AdminSessionDto {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload: SessionPayload = { sub: config.adminUsername, exp };
  reply.setCookie(SESSION_COOKIE, Buffer.from(JSON.stringify(payload)).toString('base64url'), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    signed: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return { username: config.adminUsername, expiresAt: new Date(exp * 1000).toISOString() };
}

export function clearAdminSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readAdminSession(request: FastifyRequest, config: AppConfig): AdminSessionDto | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid) return null;

  let payload: Partial<SessionPayload>;
  try {
    payload = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as Partial<SessionPayload>;
  } catch {
    return null;
  }
  if (payload?.sub !== config.adminUsername || typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return { username: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

/** Deny by default: every /api request (known route or not) needs an admin session, except login. */
export function registerAdminAuth(app: FastifyInstance, config: AppConfig): void {
  app.decorateRequest('admin', null);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    if (path !== '/api' && !path.startsWith('/api/')) return;
    if (PUBLIC_API_ROUTES.has(`${request.method} ${path}`)) return;

    const session = readAdminSession(request, config);
    if (!session) return reply.code(401).send(errorBody(401, 'Authentication required'));
    request.admin = session;
  });
}
