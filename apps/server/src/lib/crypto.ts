import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 'v1';

export const MASTER_KEY_HELP =
  'MASTER_KEY must be 32 random bytes encoded as 64 hex characters or base64 (generate one with `openssl rand -hex 32`)';

/** Decodes MASTER_KEY (64 hex chars, or base64/base64url of exactly 32 bytes). */
export function parseMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === KEY_BYTES) return decoded;
  }
  throw new Error(MASTER_KEY_HELP);
}

/** Derives an independent 256-bit subkey per purpose so the master key is never used directly. */
export function deriveKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), `mcproute:${purpose}`, KEY_BYTES));
}

/** AES-256-GCM encryption. Output: `v1:<iv>:<authTag>:<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

/** Decrypts `encryptSecret` output; throws if the payload is malformed, tampered with or the key is wrong. */
export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivPart, tagPart, dataPart, ...rest] = payload.split(':');
  if (version !== FORMAT_VERSION || ivPart === undefined || tagPart === undefined || dataPart === undefined || rest.length > 0) {
    throw new Error('Unsupported encrypted payload format');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Unsupported encrypted payload format');

  const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison (inputs are hashed first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** Endpoint access token, e.g. `mcpr_<43 base64url chars>` (256 bits of entropy). */
export function generateAccessToken(): string {
  return `mcpr_${randomBytes(32).toString('base64url')}`;
}

/** Display form of a secret: `sk-abcdef123456abcd` -> `sk-****abcd`. Short secrets reveal less. */
export function maskSecret(secret: string): string {
  if (secret.length >= 12) return `${secret.slice(0, 3)}****${secret.slice(-4)}`;
  if (secret.length >= 8) return `****${secret.slice(-2)}`;
  return '****';
}

/** Protects upstream API keys at rest with keys derived from MASTER_KEY. */
export class SecretBox {
  readonly #encryptionKey: Buffer;
  readonly #fingerprintKey: Buffer;

  constructor(masterKey: Buffer) {
    if (masterKey.length !== KEY_BYTES) throw new Error(MASTER_KEY_HELP);
    this.#encryptionKey = deriveKey(masterKey, 'api-key-encryption');
    this.#fingerprintKey = deriveKey(masterKey, 'api-key-fingerprint');
  }

  encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.#encryptionKey);
  }

  decrypt(payload: string): string {
    return decryptSecret(payload, this.#encryptionKey);
  }

  /** Keyed hash used to detect duplicate keys without decrypting stored ones. */
  fingerprint(secret: string): string {
    return createHmac('sha256', this.#fingerprintKey).update(secret, 'utf8').digest('hex');
  }
}
