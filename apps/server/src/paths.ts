import { fileURLToPath } from 'node:url';

// Resolved relative to this module, which sits one directory below the package root both as
// src/paths.ts (dev, tests) and when inlined into the dist/*.js bundles (production).
export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const DEFAULT_WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
