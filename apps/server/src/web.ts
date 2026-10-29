import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { errorBody } from './lib/errors';

const BACKEND_PREFIXES = ['/api', '/mcp'];

function isBackendPath(path: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Serves the built web UI (apps/web/dist) with an SPA fallback. The API works without it. */
export async function registerWebUi(app: FastifyInstance, webDistDir: string): Promise<void> {
  const hasUi = existsSync(join(webDistDir, 'index.html'));
  if (hasUi) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false,
      setHeaders(reply, filePath) {
        // Vite emits content-hashed files under assets/; everything else must revalidate.
        const immutable = filePath.includes(`${sep}assets${sep}`);
        reply.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else {
    app.log.info({ webDistDir }, 'Web UI build not found, serving the API only (run `pnpm build` to include it)');
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    const wantsPage =
      (request.method === 'GET' || request.method === 'HEAD') && (request.headers.accept ?? '').includes('text/html');
    if (hasUi && wantsPage && !isBackendPath(path)) return reply.sendFile('index.html');
    return reply.code(404).send(errorBody(404, `Route ${request.method} ${path} not found`));
  });
}
