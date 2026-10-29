import type { EndpointDto, EndpointProviderDto } from '@mcproute/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { endpointProviders, endpoints, providers, type EndpointRow } from '../db/schema';
import { generateAccessToken, sha256Hex } from '../lib/crypto';
import { conflict, notFound } from '../lib/errors';
import { toEndpointDto } from './dto';

export function findEndpoint(db: DbExecutor, id: string): EndpointRow {
  const row = db.select().from(endpoints).where(eq(endpoints.id, id)).get();
  if (!row) throw notFound('Endpoint');
  return row;
}

export function assertEndpointSlugAvailable(db: DbExecutor, slug: string, exceptId?: string): void {
  const row = db.select({ id: endpoints.id }).from(endpoints).where(eq(endpoints.slug, slug)).get();
  if (row && row.id !== exceptId) throw conflict(`Slug "${slug}" is already used by another endpoint`);
}

/** New access token: only its SHA-256 hash and a short hint are stored. */
export function issueAccessToken(): { token: string; hash: string; hint: string } {
  const token = generateAccessToken();
  return { token, hash: sha256Hex(token), hint: `mcpr_****${token.slice(-4)}` };
}

/** Linked providers (with tool filters) per endpoint. */
export function endpointLinks(db: DbExecutor, endpointIds?: string[]): Map<string, EndpointProviderDto[]> {
  const rows = db
    .select({
      endpointId: endpointProviders.endpointId,
      providerId: endpointProviders.providerId,
      providerName: providers.name,
      providerSlug: providers.slug,
      toolFilterMode: endpointProviders.toolFilterMode,
      toolNames: endpointProviders.toolNames,
    })
    .from(endpointProviders)
    .innerJoin(providers, eq(providers.id, endpointProviders.providerId))
    .where(endpointIds ? inArray(endpointProviders.endpointId, endpointIds) : undefined)
    .orderBy(asc(providers.name))
    .all();

  const links = new Map<string, EndpointProviderDto[]>();
  for (const { endpointId, ...link } of rows) {
    const list = links.get(endpointId) ?? [];
    list.push(link);
    links.set(endpointId, list);
  }
  return links;
}

export function getEndpointDto(db: DbExecutor, id: string): EndpointDto {
  const row = findEndpoint(db, id);
  return toEndpointDto(row, endpointLinks(db, [id]).get(id) ?? []);
}
