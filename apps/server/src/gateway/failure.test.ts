import { defaultFailureRules } from '@mcproute/shared';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { exposedName, isToolAllowed, splitExposedName } from './catalog';
import { classifyError, inspectToolResult, isConnectionLost, upstreamHttpStatus } from './failure';

const rules = defaultFailureRules();

describe('failure rules', () => {
  it('detects key failures from transport HTTP statuses', () => {
    expect(classifyError(new StreamableHTTPError(429, 'Error POSTing to endpoint: slow down'), rules)).toEqual({
      keyFailure: true,
      status: 429,
      message: 'HTTP 429: Streamable HTTP error: Error POSTing to endpoint: slow down',
    });
    expect(classifyError(new StreamableHTTPError(500, 'Error POSTing to endpoint: boom'), rules).keyFailure).toBe(false);
    expect(upstreamHttpStatus(new Error('Error POSTing to endpoint (HTTP 402): pay up'))).toBe(402);
    expect(classifyError(new Error('Error POSTing to endpoint (HTTP 403): no'), rules).message).toBe(
      'Error POSTing to endpoint (HTTP 403): no',
    );
  });

  it('matches message patterns case-insensitively, but never reads statuses from JSON-RPC errors', () => {
    expect(classifyError(new McpError(-32603, 'Rate Limit reached'), rules).keyFailure).toBe(true);
    expect(classifyError(new McpError(ErrorCode.InvalidParams, 'bad argument (HTTP 429)'), rules)).toMatchObject({
      keyFailure: false,
      status: null,
    });
    expect(classifyError(new Error('socket hang up'), { httpStatuses: [], messagePatterns: ['hang'] }).keyFailure).toBe(true);
  });

  it('inspects isError tool results', () => {
    const quota = { isError: true, content: [{ type: 'text', text: 'Insufficient credits' }] };
    expect(inspectToolResult(quota, rules)).toEqual({ error: 'Insufficient credits', keyFailure: true });
    expect(inspectToolResult({ isError: true, content: [{ type: 'text', text: 'No results' }] }, rules)).toEqual({
      error: 'No results',
      keyFailure: false,
    });
    expect(inspectToolResult({ content: [{ type: 'text', text: 'quota: 10 left' }] }, rules)).toEqual({ error: null, keyFailure: false });
  });

  it('recognizes lost upstream connections', () => {
    expect(isConnectionLost(new McpError(ErrorCode.ConnectionClosed, 'Connection closed'))).toBe(true);
    expect(isConnectionLost(new StreamableHTTPError(404, 'Session not found'))).toBe(true);
    expect(isConnectionLost(new McpError(ErrorCode.InvalidParams, 'nope'))).toBe(false);
  });
});

describe('tool names', () => {
  it('prefixes and splits on the first separator', () => {
    expect(exposedName('provider_slug', 'exa', 'web_search')).toBe('exa__web_search');
    expect(exposedName('none', 'exa', 'web_search')).toBe('web_search');
    expect(splitExposedName('exa__deep__search')).toEqual({ providerSlug: 'exa', name: 'deep__search' });
    expect(splitExposedName('web_search')).toBeNull();
    expect(splitExposedName('__x')).toBeNull();
  });

  it('applies allow and deny lists by upstream or prefixed name', () => {
    expect(isToolAllowed({ toolFilterMode: 'all', toolNames: [] }, 'exa', 'a')).toBe(true);
    expect(isToolAllowed({ toolFilterMode: 'allowlist', toolNames: ['a'] }, 'exa', 'a')).toBe(true);
    expect(isToolAllowed({ toolFilterMode: 'allowlist', toolNames: ['exa__b'] }, 'exa', 'b')).toBe(true);
    expect(isToolAllowed({ toolFilterMode: 'allowlist', toolNames: ['a'] }, 'exa', 'b')).toBe(false);
    expect(isToolAllowed({ toolFilterMode: 'denylist', toolNames: ['a'] }, 'exa', 'a')).toBe(false);
    expect(isToolAllowed({ toolFilterMode: 'denylist', toolNames: ['a'] }, 'exa', 'b')).toBe(true);
  });
});
