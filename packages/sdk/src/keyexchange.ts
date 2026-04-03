/**
 * VaultLayer Key Exchange — Ed25519/X25519 ECIES
 *
 * Provides vendor-side key wrapping and buyer-side key unwrapping using
 * Curve25519 ECDH + AES-256-KW.
 *
 * Flow:
 *   Vendor (wizard, one-time per agreement):
 *     1. Fetch buyer's Ed25519 public key from Aptos chain.
 *     2. Convert to X25519 public key (ed25519PublicToX25519).
 *     3. wrapKey(buyerX25519Public, aesArchiveKey) → { encryptedKey, ephemeralPublic }
 *        Store both on-chain in create_agreement / record_commit.
 *
 *   Buyer (post-trigger, in-browser):
 *     The browser counterpart lives in packages/app/src/lib/keyexchange-browser.ts
 *     and uses Web Crypto API exclusively.
 */

import * as crypto from 'node:crypto';
import { edwardsToMontgomery, x25519 } from '@noble/curves/ed25519';

// ─── Ed25519 ↔ X25519 conversions ────────────────────────────────────────────

/**
 * Convert an Ed25519 public key (32 bytes) to an X25519 public key.
 *
 * Uses the birational equivalence between Edwards and Montgomery curves:
 *   u = (1 + y) / (1 - y) mod p
 */
export function ed25519PublicToX25519(ed25519Public: Uint8Array): Uint8Array {
  if (ed25519Public.length !== 32) {
    throw new Error('ed25519PublicToX25519: expected 32-byte public key');
  }
  return edwardsToMontgomery(ed25519Public);
}

/**
 * Convert an Ed25519 private seed (32 bytes) to an X25519 private scalar.
 *
 * Algorithm: SHA-512(seed)[0..31], clamped per RFC 8032 §5.1.5.
 */
export function ed25519PrivateToX25519(ed25519PrivateSeed: Uint8Array): Uint8Array {
  if (ed25519PrivateSeed.length !== 32) {
    throw new Error('ed25519PrivateToX25519: expected 32-byte private seed');
  }
  const hash   = crypto.createHash('sha512').update(ed25519PrivateSeed).digest();
  const scalar = new Uint8Array(hash.buffer, 0, 32);
  scalar[0]!  &= 248;
  scalar[31]! &= 127;
  scalar[31]! |= 64;
  return scalar;
}

// ─── Key wrapping (vendor side) ───────────────────────────────────────────────

export interface WrappedKey {
  /**
   * 72-byte packed blob (hex): ephemeralPublic (32 B) || AES-KW wrappedKey (40 B).
   * Store as `encrypted_key` on-chain.
   */
  encryptedKey: string;
  /**
   * Hex-encoded 32-byte ephemeral X25519 public key.
   * Included inside encryptedKey but exposed separately for convenience.
   */
  ephemeralPublic: string;
}

/**
 * Wrap an AES-256 archive key for a specific buyer.
 *
 * @param buyerX25519Public  Buyer's X25519 public key (32 bytes).
 * @param aesKey             The 32-byte AES-256-GCM archive encryption key.
 */
export function wrapKey(buyerX25519Public: Uint8Array, aesKey: Buffer): WrappedKey {
  if (buyerX25519Public.length !== 32) throw new Error('wrapKey: buyerX25519Public must be 32 bytes');
  if (aesKey.length !== 32)            throw new Error('wrapKey: aesKey must be 32 bytes');

  // Generate ephemeral X25519 key pair.
  const ephemeralPrivate = x25519.utils.randomSecretKey();
  const ephemeralPublic  = x25519.getPublicKey(ephemeralPrivate);

  // ECDH: derive shared secret.
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, buyerX25519Public);

  // AES-256-KW: wrap the archive key with the shared secret.
  const kek        = crypto.createSecretKey(sharedSecret);
  const wrappedKey = crypto.createCipheriv('id-aes256-wrap', kek, Buffer.alloc(0)).update(aesKey);

  // Pack: ephemeralPublic (32 B) || wrappedKey (40 B) = 72 bytes.
  const combined = Buffer.concat([Buffer.from(ephemeralPublic), Buffer.from(wrappedKey)]);

  return {
    encryptedKey:   combined.toString('hex'),
    ephemeralPublic: Buffer.from(ephemeralPublic).toString('hex'),
  };
}

/**
 * Unwrap an AES-256 archive key using the buyer's X25519 private key.
 *
 * @param buyerX25519Private  Buyer's X25519 private scalar (32 bytes).
 * @param encryptedKeyHex     Hex-encoded 72-byte packed encrypted_key from on-chain.
 */
export function unwrapKey(buyerX25519Private: Uint8Array, encryptedKeyHex: string): Buffer {
  const packed = Buffer.from(encryptedKeyHex, 'hex');
  if (packed.length !== 72) throw new Error('unwrapKey: encryptedKey must be 72 bytes');

  const ephemeralPublic = packed.subarray(0, 32);
  const wrappedKeyBytes = packed.subarray(32);

  const sharedSecret = x25519.getSharedSecret(buyerX25519Private, ephemeralPublic);
  const kek          = crypto.createSecretKey(sharedSecret);

  try {
    const unwrapped = crypto.createDecipheriv('id-aes256-wrap', kek, Buffer.alloc(0)).update(wrappedKeyBytes);
    return Buffer.from(unwrapped);
  } catch {
    throw new Error('unwrapKey: decryption failed — wrong private key or corrupted data');
  }
}
