import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SecretBox,
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateAccessToken,
  maskSecret,
  parseMasterKey,
  safeEqual,
  sha256Hex,
} from './crypto';

const key = () => randomBytes(32);

describe('encryptSecret / decryptSecret (AES-256-GCM)', () => {
  it('round-trips ASCII, unicode, empty and long values', () => {
    const k = key();
    for (const plaintext of ['sk-abcdef1234567890', 'ключ-🔑-密钥', '', 'x'.repeat(10_000)]) {
      expect(decryptSecret(encryptSecret(plaintext, k), k)).toBe(plaintext);
    }
  });

  it('produces a versioned payload with a fresh IV each time', () => {
    const k = key();
    const a = encryptSecret('same-secret', k);
    const b = encryptSecret('same-secret', k);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[\w-]{16}:[\w-]{22}:[\w-]+$/);
    expect(a).not.toContain('same-secret');
  });

  it('fails with the wrong key', () => {
    const payload = encryptSecret('sk-secret', key());
    expect(() => decryptSecret(payload, key())).toThrow();
  });

  it('detects tampering with the IV, auth tag or ciphertext', () => {
    const k = key();
    const [version, iv, tag, data] = encryptSecret('sk-secret-value', k).split(':') as [string, string, string, string];
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url');
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      return bytes.toString('base64url');
    };
    expect(() => decryptSecret([version, flip(iv), tag, data].join(':'), k)).toThrow();
    expect(() => decryptSecret([version, iv, flip(tag), data].join(':'), k)).toThrow();
    expect(() => decryptSecret([version, iv, tag, flip(data)].join(':'), k)).toThrow();
  });

  it('rejects malformed payloads', () => {
    const k = key();
    for (const payload of ['', 'plaintext', 'v2:a:b:c', 'v1:a:b', 'v1:AAAA:AAAA:AAAA', `${encryptSecret('x', k)}:extra`]) {
      expect(() => decryptSecret(payload, k)).toThrow();
    }
  });
});

describe('SecretBox', () => {
  it('round-trips API keys using keys derived from MASTER_KEY', () => {
    const masterKey = key();
    const payload = new SecretBox(masterKey).encrypt('exa-1234-5678-abcd');
    // A new instance with the same MASTER_KEY (e.g. after a restart) can decrypt.
    expect(new SecretBox(masterKey).decrypt(payload)).toBe('exa-1234-5678-abcd');
    expect(() => new SecretBox(key()).decrypt(payload)).toThrow();
  });

  it('never uses the master key directly', () => {
    const masterKey = key();
    const payload = new SecretBox(masterKey).encrypt('sk-test');
    expect(() => decryptSecret(payload, masterKey)).toThrow();
    expect(decryptSecret(payload, deriveKey(masterKey, 'api-key-encryption'))).toBe('sk-test');
  });

  it('fingerprints keys deterministically, per master key', () => {
    const masterKey = key();
    const box = new SecretBox(masterKey);
    expect(box.fingerprint('sk-a')).toBe(new SecretBox(masterKey).fingerprint('sk-a'));
    expect(box.fingerprint('sk-a')).not.toBe(box.fingerprint('sk-b'));
    expect(box.fingerprint('sk-a')).not.toBe(new SecretBox(key()).fingerprint('sk-a'));
    expect(box.fingerprint('sk-a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects master keys of the wrong size', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow(/MASTER_KEY/);
  });
});

describe('parseMasterKey', () => {
  it('accepts 64 hex characters and base64 / base64url encodings of 32 bytes', () => {
    const raw = key();
    expect(parseMasterKey(raw.toString('hex'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('hex').toUpperCase())).toEqual(raw);
    expect(parseMasterKey(raw.toString('base64'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('base64url'))).toEqual(raw);
    expect(parseMasterKey(`  ${raw.toString('hex')}\n`)).toEqual(raw);
  });

  it('rejects passphrases and keys of the wrong length', () => {
    for (const value of ['', 'changeme', 'a'.repeat(63), 'a'.repeat(65), randomBytes(16).toString('base64')]) {
      expect(() => parseMasterKey(value)).toThrow(/openssl rand -hex 32/);
    }
  });
});

describe('helpers', () => {
  it('masks secrets for display', () => {
    expect(maskSecret('sk-abcdef123456abcd')).toBe('sk-****abcd');
    expect(maskSecret('0f6e4b9a-1c2d-4e5f-8a9b-c3d2e1f06e5c')).toBe('0f6****6e5c');
    expect(maskSecret('short123')).toBe('****23');
    expect(maskSecret('tiny')).toBe('****');
  });

  it('hashes and compares values', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secret2')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('generates unique prefixed access tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateAccessToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^mcpr_[\w-]{43}$/);
  });
});
