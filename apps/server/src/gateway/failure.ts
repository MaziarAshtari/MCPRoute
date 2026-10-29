import type { FailureRules } from '@mcproute/shared';
import { SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorText, redactSecrets, truncate } from '../lib/redact';

const patternCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  let regex = patternCache.get(pattern);
  if (regex === undefined) {
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      regex = null;
    }
    patternCache.set(pattern, regex);
  }
  return regex;
}

export function matchesFailurePattern(text: string, rules: FailureRules): boolean {
  return rules.messagePatterns.some((pattern) => compile(pattern)?.test(text) ?? false);
}

/**
 * HTTP status of an upstream transport error: Streamable HTTP and SSE client errors carry it as `code`,
 * the legacy SSE POST error only in its message ("Error POSTing to endpoint (HTTP 429): ...").
 * JSON-RPC errors (McpError) come from the upstream server itself and have no HTTP status.
 */
export function upstreamHttpStatus(error: unknown): number | null {
  if (error instanceof StreamableHTTPError || error instanceof SseError) {
    const code = error.code;
    return typeof code === 'number' && code >= 100 && code <= 599 ? code : null;
  }
  if (error instanceof McpError || !(error instanceof Error)) return null;
  const match = /\(HTTP (\d{3})\)/.exec(error.message);
  return match ? Number(match[1]) : null;
}

/** Error text, starting with `HTTP <status>:` when the upstream answered with an HTTP error the text omits. */
export function upstreamErrorText(error: unknown): string {
  const status = upstreamHttpStatus(error);
  const text = errorText(error);
  return status !== null && !text.includes(`HTTP ${status}`) ? `HTTP ${status}: ${text}` : text;
}

/** `upstreamErrorText`, with secrets masked and the length capped: safe to store, log and return. */
export function safeUpstreamError(error: unknown, secrets: readonly string[] = []): string {
  return truncate(redactSecrets(upstreamErrorText(error), secrets));
}

export interface FailureVerdict {
  /** The error is attributed to the API key: cool it down and fail over. */
  keyFailure: boolean;
  status: number | null;
  /** Error text, starting with `HTTP <status>:` when the status is known but not part of the text. */
  message: string;
}

export function classifyError(error: unknown, rules: FailureRules): FailureVerdict {
  const status = upstreamHttpStatus(error);
  const keyFailure =
    (status !== null && rules.httpStatuses.includes(status)) || matchesFailurePattern(errorText(error), rules);
  return { keyFailure, status, message: upstreamErrorText(error) };
}

interface ToolResultLike {
  isError?: unknown;
  content?: unknown;
}

/** Text of a tool result's text content blocks. */
export function toolResultText(result: ToolResultLike): string {
  if (!Array.isArray(result.content)) return '';
  return result.content
    .flatMap((block: unknown) =>
      block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
        ? [String((block as { text?: unknown }).text ?? '')]
        : [],
    )
    .join('\n');
}

/** For `isError` tool results: the error text, and whether it matches the provider's key-failure patterns. */
export function inspectToolResult(result: ToolResultLike, rules: FailureRules): { error: string | null; keyFailure: boolean } {
  if (result.isError !== true) return { error: null, keyFailure: false };
  const text = toolResultText(result) || 'Tool returned an error';
  return { error: text, keyFailure: matchesFailurePattern(text, rules) };
}

/**
 * The upstream connection is gone (process exited, upstream session expired, transport closed):
 * reconnecting with the same key is worth one retry.
 */
export function isConnectionLost(error: unknown): boolean {
  if (error instanceof McpError) return error.code === ErrorCode.ConnectionClosed;
  if (error instanceof StreamableHTTPError) return error.code === 404;
  return error instanceof Error && error.message === 'Not connected';
}
