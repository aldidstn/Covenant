// ─── Configuration ───────────────────────────────────────────────────────────

export interface VaultLayerConfig {
  /** Shelby API key from geomi.dev. Omit for anonymous (lower rate limits). */
  shelbyApiKey?: string;
  /** Hex-encoded Ed25519 private key for the vendor's Aptos / Shelby account. */
  shelbyPrivateKey: string;
  /** Only 'shelbynet' is available until Shelby mainnet launches. */
  network?: 'shelbynet';
}

// ─── Commit ──────────────────────────────────────────────────────────────────

export interface CommitOptions {
  /**
   * Zip archive buffer of the source code to escrow.
   * The GitHub Action will produce this via `git archive --format=zip HEAD`.
   */
  archiveData: Buffer;
  /**
   * Unique blob name for this deposit, e.g. "myapp/v1.2.3".
   * Must be unique per Shelby account. Re-using a name will throw
   * EBLOB_WRITE_CHUNKSET_ALREADY_EXISTS.
   */
  blobName: string;
  /**
   * 32-byte AES-256-GCM encryption key. VaultLayer never sees this —
   * the archive is encrypted client-side before being sent to Shelby.
   * Generate with `VaultLayerClient.generateKey()`.
   */
  encryptionKey: Buffer;
  /** Days to retain the blob on Shelby. Defaults to 365. */
  expirationDays?: number;
}

export interface CommitResult {
  blobName: string;
  /** Aptos address of the Shelby account that owns this blob. */
  accountAddress: string;
  /**
   * SHA-256 Merkle root computed over the unencrypted source files.
   * This is what gets stored on the Aptos escrow smart contract and used
   * for buyer inclusion proofs.
   */
  contentMerkleRoot: string;
  /**
   * Merkle root reported by Shelby for the stored blob (integrity of the
   * storage layer). May be empty if Shelby metadata doesn't expose it yet.
   */
  shelbyMerkleRoot: string;
  /** Unix milliseconds of the commit. */
  commitTimestamp: number;
  /** Byte size of the encrypted archive uploaded to Shelby. */
  encryptedSize: number;
  /** AES-GCM initialisation vector (hex). Store alongside the contract. */
  iv: string;
  /** AES-GCM authentication tag (hex). Store alongside the contract. */
  authTag: string;
}

// ─── Inclusion proof ─────────────────────────────────────────────────────────

export interface ProveInclusionOptions {
  blobName: string;
  /** Aptos address that owns the blob on Shelby. */
  accountAddress: string;
  /**
   * Relative path of the file inside the archive, exactly as it was when
   * the commit was made (e.g. "src/index.ts").
   */
  filePath: string;
  /** Content of the file to prove inclusion for. */
  fileData: Buffer;
}

export interface InclusionProof {
  included: boolean;
  filePath: string;
  /** SHA-256 hash of the file (leaf hash in the Merkle tree). */
  fileHash: string;
  contentMerkleRoot: string;
  /**
   * Sibling hashes walking from leaf to root. Empty array if `included` is
   * false (nothing to prove). Use `verifyInclusionProof()` to re-check.
   */
  proof: Array<{ hash: string; position: 'left' | 'right' }>;
  verifiedAt: number;
}

// ─── Download ────────────────────────────────────────────────────────────────

export interface DownloadOptions {
  blobName: string;
  accountAddress: string;
  encryptionKey: Buffer;
  /** Hex IV from CommitResult. */
  iv: string;
  /** Hex auth tag from CommitResult. */
  authTag: string;
}

// ─── Blob list ───────────────────────────────────────────────────────────────

export interface BlobInfo {
  blobName: string;
  /** Blob size in bytes. */
  size: number;
  /** Unix microseconds expiry timestamp from Shelby. */
  expirationMicros: number;
}

// ─── Internal: Merkle tree metadata (stored as __meta blob on Shelby) ────────

export interface MerkleTreeMeta {
  version: 1;
  blobName: string;
  contentMerkleRoot: string;
  /** Sorted list of (relativePath, leafHash) pairs — the Merkle tree leaves. */
  leaves: Array<{ path: string; hash: string }>;
  /**
   * All levels of the tree from leaves (index 0) to root (last item).
   * Each level is an array of hex hashes.
   *
   * Note: file paths are stored here so buyers can see which files are
   * committed but NOT their contents (which remain encrypted on Shelby).
   */
  levels: string[][];
  createdAt: number;
}
