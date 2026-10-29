const MASK = '****';
const MIN_SECRET_LENGTH = 4;
export const MAX_ERROR_LENGTH = 1000;

type Secrets = readonly (string | null | undefined)[];

const activeSecrets = (secrets: Secrets): string[] =>
  secrets.filter((secret): secret is string => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH);

/** Masks the given secrets and any `user:password@` URL credentials in a message. */
export function redactSecrets(text: string, secrets: Secrets = []): string {
  let result = text;
  for (const secret of activeSecrets(secrets)) result = result.replaceAll(secret, MASK);
  return result.replace(/(\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${MASK}@`);
}

/**
 * Masks secrets anywhere inside a JSON-serializable value (e.g. an upstream tool result echoing the API key).
 * Returns the value untouched when it contains none of them.
 */
export function redactValue<T>(value: T, secrets: Secrets): T {
  const escaped = activeSecrets(secrets).map((secret) => JSON.stringify(secret).slice(1, -1));
  if (escaped.length === 0) return value;
  const json = JSON.stringify(value);
  if (json === undefined || !escaped.some((secret) => json.includes(secret))) return value;
  let result = json;
  for (const secret of escaped) result = result.replaceAll(secret, MASK);
  return JSON.parse(result) as T;
}

export function truncate(text: string, max: number = MAX_ERROR_LENGTH): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Readable message for any thrown value; undici's "fetch failed" carries the real reason in `cause`. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  if (cause instanceof Error) {
    const reason = cause.message || (cause as { code?: string }).code || cause.name;
    if (reason && !error.message.includes(reason)) return `${error.message}: ${reason}`;
  }
  return error.message || error.name;
}

/** Error text that is safe to store, log and return: secrets masked, length capped. */
export function safeErrorText(error: unknown, secrets: Secrets = []): string {
  return truncate(redactSecrets(errorText(error), secrets));
}
