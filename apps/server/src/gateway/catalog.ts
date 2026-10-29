import { TOOL_PREFIX_SEPARATOR, type ToolFilterMode, type ToolPrefixMode } from '@mcproute/shared';

export interface ToolFilter {
  toolFilterMode: ToolFilterMode;
  toolNames: readonly string[];
}

/** Name exposed by the endpoint: `{providerSlug}__{name}` in provider_slug mode, else unchanged. */
export function exposedName(mode: ToolPrefixMode, providerSlug: string, name: string): string {
  return mode === 'provider_slug' ? `${providerSlug}${TOOL_PREFIX_SEPARATOR}${name}` : name;
}

/**
 * Splits `{providerSlug}__{name}`. Slugs never contain underscores, so the first separator is the boundary
 * even when the upstream name itself contains `__`.
 */
export function splitExposedName(exposed: string): { providerSlug: string; name: string } | null {
  const index = exposed.indexOf(TOOL_PREFIX_SEPARATOR);
  if (index <= 0) return null;
  const name = exposed.slice(index + TOOL_PREFIX_SEPARATOR.length);
  return name ? { providerSlug: exposed.slice(0, index), name } : null;
}

/** Applies an endpoint link's allow/deny list. Lists may use the upstream or the prefixed name. */
export function isToolAllowed(filter: ToolFilter, providerSlug: string, name: string): boolean {
  if (filter.toolFilterMode === 'all') return true;
  const listed =
    filter.toolNames.includes(name) || filter.toolNames.includes(exposedName('provider_slug', providerSlug, name));
  return filter.toolFilterMode === 'allowlist' ? listed : !listed;
}
