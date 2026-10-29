import { z } from 'zod';
import { LOG_STATUSES } from '../constants';
import { idSchema, paginationQuerySchema } from './common';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 8601 date or date-time. A date-only upper bound covers that whole (UTC) day. */
const dateBound = (bound: 'from' | 'to') =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value, ctx) => {
      const date = new Date(bound === 'to' && DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value);
      if (Number.isNaN(date.getTime())) {
        ctx.issues.push({ code: 'custom', message: 'Invalid date (use ISO 8601)', input: value });
        return z.NEVER;
      }
      return date;
    });

/** GET /api/logs. `from` / `to` form an inclusive range on createdAt. */
export const logsQuerySchema = paginationQuerySchema
  .extend({
    endpointId: idSchema.optional(),
    providerId: idSchema.optional(),
    apiKeyId: idSchema.optional(),
    status: z.enum(LOG_STATUSES).optional(),
    from: dateBound('from').optional(),
    to: dateBound('to').optional(),
  })
  .refine((query) => !query.from || !query.to || query.from.getTime() <= query.to.getTime(), {
    message: '"from" must not be after "to"',
    path: ['from'],
  });
export type LogsQuery = z.output<typeof logsQuerySchema>;

/** GET /api/sessions (only sessions that have not expired). */
export const sessionsQuerySchema = paginationQuerySchema.extend({
  endpointId: idSchema.optional(),
});
export type SessionsQuery = z.output<typeof sessionsQuerySchema>;

/** MCP session ids are opaque strings issued by the gateway. */
export const sessionIdParamsSchema = z.object({ id: z.string().min(1).max(256) });
