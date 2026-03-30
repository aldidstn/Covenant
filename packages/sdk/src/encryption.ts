import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { EncryptionError } from './errors.js';

export const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;  // 256-bit
const IV_LENGTH = 12;   // 96-bit — recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Generate a cryptographically random 256-bit AES key.
 */
export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Encrypt `data` with AES-256-GCM using the provided `key`.
 * A random 96-bit IV is generated for every call.
 * The caller must persist `iv` and `authTag` alongside the blob — both are
 * required for decryption and are safe to store in plaintext.
 */
export function encryptBlob(data: Buffer, key: Buffer): EncryptResult {
  if (key.length !== KEY_LENGTH) {
    throw new EncryptionError(`Key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/**
 * Decrypt `ciphertext` with AES-256-GCM.
 * Throws if the auth tag doesn't match (data was tampered with).
 */
export function decryptBlob(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer | string,
  authTag: Buffer | string,
): Buffer {
  if (key.length !== KEY_LENGTH) {
    throw new EncryptionError(`Key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const ivBuf = typeof iv === 'string' ? Buffer.from(iv, 'hex') : iv;
  const tagBuf = typeof authTag === 'string' ? Buffer.from(authTag, 'hex') : authTag;

  if (ivBuf.length !== IV_LENGTH) {
    throw new EncryptionError(`IV must be ${IV_LENGTH} bytes, got ${ivBuf.length}`);
  }
  if (tagBuf.length !== TAG_LENGTH) {
    throw new EncryptionError(`Auth tag must be ${TAG_LENGTH} bytes, got ${tagBuf.length}`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
    decipher.setAuthTag(tagBuf);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EncryptionError(
      'Decryption failed — wrong key, IV, or the ciphertext has been tampered with.',
    );
  }
}
