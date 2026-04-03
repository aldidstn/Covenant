/**
 * Browser-native key exchange for VaultLayer buyers.
 *
 * Mirrors packages/sdk/src/keyexchange.ts but uses Web Crypto API exclusively,
 * so it runs in-browser without any Node.js dependencies.
 *
 * Post-trigger flow:
 *   1. Buyer provides their Ed25519 private seed (32 bytes, hex).
 *   2. ed25519PrivateToX25519Browser() derives the X25519 private scalar.
 *   3. unwrapKeyBrowser() reconstructs the shared secret and unwraps the
 *      AES-256-GCM archive key.
 *   4. decryptArchiveBrowser() decrypts the ciphertext downloaded from Shelby.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Copy a Uint8Array into a fresh ArrayBuffer.
 * Web Crypto APIs require a concrete ArrayBuffer, not Uint8Array<ArrayBufferLike>.
 */
function toAB(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

// ─── Ed25519 private seed → X25519 private scalar ────────────────────────────

/**
 * Derives the X25519 private scalar from an Ed25519 private seed.
 *
 * Algorithm:
 *   1. SHA-512 hash the 32-byte seed.
 *   2. Take the low 32 bytes.
 *   3. Clamp per RFC 8032 §5.1.5.
 *
 * This matches the Node.js implementation in @vaultlayer/sdk.
 */
export async function ed25519PrivateToX25519Browser(
  ed25519PrivateSeedHex: string,
): Promise<Uint8Array> {
  const seed = hexToBytes(ed25519PrivateSeedHex);
  if (seed.length !== 32) throw new Error('ed25519PrivateToX25519Browser: expected 32-byte seed');

  const hashBuffer = await crypto.subtle.digest('SHA-512', toAB(seed));
  const scalar = new Uint8Array(hashBuffer.slice(0, 32));

  // Clamp per RFC 8032 §5.1.5
  scalar[0]!  &= 248;
  scalar[31]! &= 127;
  scalar[31]! |= 64;

  return scalar;
}

// ─── X25519 ECDH using Web Crypto ─────────────────────────────────────────────

/**
 * Perform X25519 ECDH in-browser to derive the shared secret.
 *
 * Web Crypto supports X25519 natively (Chrome 113+, Firefox 130+, Safari 17+).
 */
async function x25519SharedSecret(
  privateScalar: Uint8Array,
  peerPublicBytes: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    'raw',
    toAB(privateScalar),
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );

  const publicKey = await crypto.subtle.importKey(
    'raw',
    toAB(peerPublicBytes),
    { name: 'X25519' },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256,
  );

  return new Uint8Array(sharedBits);
}

// ─── AES-KW unwrap ────────────────────────────────────────────────────────────

/**
 * Unwrap an AES-256-GCM archive key that was wrapped with AES-256-KW.
 *
 * @param sharedSecret    32-byte ECDH shared secret (the key-encryption key).
 * @param wrappedKeyBytes The wrapped key bytes from on-chain `encrypted_key`.
 * @returns The unwrapped 32-byte AES-256-GCM archive key as a CryptoKey.
 */
async function aesKwUnwrap(
  sharedSecret: Uint8Array,
  wrappedKeyBytes: Uint8Array,
): Promise<CryptoKey> {
  const kek = await crypto.subtle.importKey(
    'raw',
    toAB(sharedSecret),
    { name: 'AES-KW' },
    false,
    ['unwrapKey'],
  );

  return crypto.subtle.unwrapKey(
    'raw',
    toAB(wrappedKeyBytes),
    kek,
    'AES-KW',
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface UnwrapResult {
  /** The recovered AES-256-GCM archive key as a CryptoKey. */
  archiveKey: CryptoKey;
}

/**
 * Unwrap the AES archive key using the buyer's Ed25519 private seed.
 *
 * The on-chain `encrypted_key` field is a 72-byte packed blob:
 *   [0..31]  = ephemeral X25519 public key
 *   [32..71] = AES-KW wrapped archive key
 *
 * @param buyerPrivateSeedHex  Hex-encoded 32-byte Ed25519 private seed.
 * @param encryptedKeyHex      Hex-encoded 72-byte packed encrypted_key from chain.
 */
export async function unwrapKeyBrowser(
  buyerPrivateSeedHex: string,
  encryptedKeyHex: string,
): Promise<UnwrapResult> {
  const packed = hexToBytes(encryptedKeyHex);
  if (packed.length !== 72) throw new Error('unwrapKeyBrowser: encrypted_key must be 72 bytes');

  const ephemeralPublic = packed.slice(0, 32);
  const wrappedKeyBytes = packed.slice(32);

  const x25519Private = await ed25519PrivateToX25519Browser(buyerPrivateSeedHex);
  const sharedSecret  = await x25519SharedSecret(x25519Private, ephemeralPublic);
  const archiveKey    = await aesKwUnwrap(sharedSecret, wrappedKeyBytes);

  return { archiveKey };
}

/**
 * Decrypt an AES-256-GCM encrypted archive blob.
 *
 * @param archiveKey      CryptoKey from unwrapKeyBrowser().
 * @param ciphertextBytes Full ciphertext bytes downloaded from Shelby.
 * @param ivHex           Hex-encoded 12-byte IV from the TriggerExecuted event.
 * @param authTagHex      Hex-encoded 16-byte auth tag from the TriggerExecuted event.
 */
export async function decryptArchiveBrowser(
  archiveKey: CryptoKey,
  ciphertextBytes: Uint8Array,
  ivHex: string,
  authTagHex: string,
): Promise<Uint8Array> {
  const iv      = hexToBytes(ivHex);
  const authTag = hexToBytes(authTagHex);

  // Web Crypto AES-GCM expects ciphertext || authTag concatenated.
  const combined = new Uint8Array(ciphertextBytes.length + authTag.length);
  combined.set(ciphertextBytes);
  combined.set(authTag, ciphertextBytes.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toAB(iv), tagLength: 128 },
    archiveKey,
    toAB(combined),
  );

  return new Uint8Array(plaintext);
}

/**
 * Derive buyer's X25519 public key from their Ed25519 public key bytes.
 *
 * Uses the birational map: u = (1 + y) / (1 - y) mod p
 * where y is the Ed25519 y-coordinate (with sign bit cleared).
 *
 * Used by the vendor wizard to compute the buyer's X25519 public key
 * on-the-fly from their on-chain Ed25519 key, without requiring any
 * interaction from the buyer.
 */
export function ed25519PublicToX25519Browser(ed25519PublicBytes: Uint8Array): Uint8Array {
  if (ed25519PublicBytes.length !== 32) {
    throw new Error('ed25519PublicToX25519Browser: expected 32-byte key');
  }

  // p = 2^255 - 19
  const p = (1n << 255n) - 19n;

  // Extract y-coordinate: clear the sign bit (MSB of last byte).
  const yBytes = new Uint8Array(ed25519PublicBytes);
  yBytes[31] = yBytes[31]! & 0x7f;

  // Interpret as little-endian bigint.
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    y = (y << 8n) | BigInt(yBytes[i]!);
  }

  // Montgomery u = (1 + y) / (1 - y) mod p
  // Modular inverse via Fermat: a^(p-2) mod p
  const modpow = (base: bigint, exp: bigint, mod: bigint): bigint => {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      exp >>= 1n;
      base = (base * base) % mod;
    }
    return result;
  };

  const num = (1n + y) % p;
  const den = ((1n - y) % p + p) % p;
  const u   = (num * modpow(den, p - 2n, p)) % p;

  // Encode u as 32-byte little-endian.
  const out = new Uint8Array(32);
  let tmp = u;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return out;
}

// ─── Key wrapping (vendor side, in-browser) ───────────────────────────────────

export interface WrappedKeyBrowser {
  /**
   * Hex-encoded 72-byte blob: ephemeralPublic (32 B) || AES-KW wrappedKey (40 B).
   * Store the whole thing on-chain as `encrypted_key`.
   * The buyer splits it automatically in unwrapKeyBrowser().
   */
  encryptedKeyHex: string;
  /**
   * Hex-encoded raw 32-byte AES-256-GCM archive key.
   * The vendor must store this as a GitHub Action secret (VAULTLAYER_ENCRYPTION_KEY).
   * Never share this — it protects the source archive.
   */
  rawAesKeyHex: string;
}

/**
 * Generate a fresh AES-256-GCM archive key and wrap it for the buyer using
 * X25519 ECDH + AES-256-KW, entirely in-browser.
 *
 * @param buyerEd25519PublicHex  Hex-encoded 32-byte Ed25519 public key of the buyer.
 *                               Fetched from Aptos chain by the wizard.
 */
export async function wrapKeyBrowser(
  buyerEd25519PublicHex: string,
): Promise<WrappedKeyBrowser> {
  // 1. Convert buyer Ed25519 pubkey → X25519 pubkey.
  const buyerEd25519Bytes = hexToBytes(buyerEd25519PublicHex);
  const buyerX25519Bytes  = ed25519PublicToX25519Browser(buyerEd25519Bytes);

  // 2. Import buyer X25519 public key into Web Crypto.
  const buyerPublicKey = await crypto.subtle.importKey(
    'raw',
    toAB(buyerX25519Bytes),
    { name: 'X25519' },
    false,
    [],
  );

  // 3. Generate ephemeral X25519 key pair.
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;

  // 4. ECDH: derive 256-bit shared secret.
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: buyerPublicKey },
    ephemeralPair.privateKey,
    256,
  );

  // 5. Generate random 32-byte AES-256-GCM archive key.
  const rawAesKeyBytes = crypto.getRandomValues(new Uint8Array(32));

  // 6. Import archive key as a wrappable CryptoKey.
  const archiveKey = await crypto.subtle.importKey(
    'raw',
    toAB(rawAesKeyBytes),
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt'],
  );

  // 7. AES-256-KW: wrap archive key with shared secret.
  const kek = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'AES-KW' },
    false,
    ['wrapKey'],
  );
  const wrappedKeyBuffer = await crypto.subtle.wrapKey('raw', archiveKey, kek, 'AES-KW');
  const wrappedKeyBytes  = new Uint8Array(wrappedKeyBuffer); // 40 bytes

  // 8. Export ephemeral public key (32 bytes).
  const ephemeralPublicBuffer = await crypto.subtle.exportKey('raw', (ephemeralPair as CryptoKeyPair).publicKey);
  const ephemeralPublicBytes  = new Uint8Array(ephemeralPublicBuffer); // 32 bytes

  // 9. Pack: ephemeralPublic (32 B) || wrappedKey (40 B) = 72 bytes total.
  const combined = new Uint8Array(72);
  combined.set(ephemeralPublicBytes, 0);
  combined.set(wrappedKeyBytes, 32);

  return {
    encryptedKeyHex: bytesToHex(combined),
    rawAesKeyHex:    bytesToHex(rawAesKeyBytes),
  };
}

export { bytesToHex, hexToBytes };
