import { defineConfig } from 'drizzle-kit';

// Only used to generate SQL migrations (`pnpm db:generate`); they are applied by
// `pnpm db:migrate` and automatically on server start.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
