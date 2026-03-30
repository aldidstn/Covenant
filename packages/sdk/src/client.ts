import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {
  Account,
  Ed25519PrivateKey,
  AccountAddress,
} from '@aptos-labs/ts-sdk';
import { ShelbyNodeClient, Network } from '@shelby-protocol/sdk/node';

import { generateKey, encryptBlob, decryptBlob } from './encryption.js';
import { buildMerkleTree, proveInclusion } from './merkle.js';
import {
  ConfigurationError,
  ShelbyUploadError,
  ShelbyDownloadError,
  ArchiveError,
} from './errors.js';
import type {
  VaultLayerConfig,
  CommitOptions,
  CommitResult,
  ProveInclusionOptions,
  InclusionProof,
  DownloadOptions,
  BlobInfo,
  MerkleTreeMeta,
} from './types.js';

const META_SUFFIX = '__meta';
const DEFAULT_EXPIRATION_DAYS = 365;

export class VaultLayerClient {
  private readonly shelby: ShelbyNodeClient;
  private readonly signer: Account;

  constructor(config: VaultLayerConfig) {
    if (!config.shelbyPrivateKey) {
      throw new ConfigurationError('shelbyPrivateKey is required.');
    }

    this.signer = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(config.shelbyPrivateKey),
    });

    this.shelby = new ShelbyNodeClient({
      apiKey: config.shelbyApiKey,
      account: this.signer,
      network: Network.SHELBYNET,
    });
  }

  // ─── Public: key generation ─────────────────────────────────────────────

  /**
   * Generate a cryptographically random 32-byte AES-256-GCM key.
   * The vendor should store this securely and share the encrypted version
   * with the buyer via the Aptos escrow smart contract.
   */
  generateKey(): Buffer {
    return generateKey();
  }

  /**
   * The Aptos address of this client's Shelby account.
   * Used when referencing blobs in smart contract calls.
   */
  get accountAddress(): string {
    return this.signer.accountAddress.toString();
  }

  // ─── Public: commit ─────────────────────────────────────────────────────

  /**
   * Commit a source archive to Shelby:
   * 1. Extract all files from the zip archive and build a content Merkle tree.
   * 2. Encrypt the archive with AES-256-GCM (client-side, zero-knowledge).
   * 3. Upload the encrypted blob to Shelby.
   * 4. Upload the unencrypted Merkle tree metadata as a separate __meta blob.
   * 5. Return CommitResult — pass contentMerkleRoot + iv + authTag to the
   *    Aptos escrow contract's `record_commit` entry function.
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const {
      archiveData,
      blobName,
      encryptionKey,
      expirationDays = DEFAULT_EXPIRATION_DAYS,
    } = options;

    const expirationMicros =
      Date.now() * 1_000 + expirationDays * 24 * 60 * 60 * 1_000_000;

    // 1. Build content Merkle tree from the archive files.
    const files = await this.extractArchive(archiveData);
    const merkleTree = buildMerkleTree(blobName, files);

    // 2. Encrypt the archive.
    const { ciphertext, iv, authTag } = encryptBlob(archiveData, encryptionKey);

    // 3. Upload encrypted blob to Shelby.
    try {
      await this.shelby.upload({
        blobData: ciphertext,
        signer: this.signer,
        blobName,
        expirationMicros,
      });
    } catch (err) {
      throw new ShelbyUploadError(
        `Failed to upload encrypted blob "${blobName}": ${String(err)}`,
        err,
      );
    }

    // 4. Upload Merkle tree metadata as a separate unencrypted blob.
    //    This allows the buyer verification portal to compute inclusion proofs
    //    without downloading the full encrypted archive.
    //    Note: file paths are visible; file contents remain encrypted.
    const metaBlobName = `${blobName}${META_SUFFIX}`;
    const metaJson = Buffer.from(JSON.stringify(merkleTree), 'utf8');
    try {
      await this.shelby.upload({
        blobData: metaJson,
        signer: this.signer,
        blobName: metaBlobName,
        expirationMicros,
      });
    } catch (err) {
      throw new ShelbyUploadError(
        `Failed to upload Merkle metadata blob "${metaBlobName}": ${String(err)}`,
        err,
      );
    }

    // 5. Fetch Shelby's own Merkle root from blob metadata (best-effort).
    const shelbyMerkleRoot = await this.fetchShelbyMerkleRoot(blobName);

    return {
      blobName,
      accountAddress: this.accountAddress,
      contentMerkleRoot: merkleTree.contentMerkleRoot,
      shelbyMerkleRoot,
      commitTimestamp: Date.now(),
      encryptedSize: ciphertext.length,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  // ─── Public: prove inclusion ─────────────────────────────────────────────

  /**
   * Prove that a specific file was part of the committed deposit.
   * Fetches the Merkle tree metadata from Shelby (no decryption required)
   * and returns a Merkle inclusion proof.
   *
   * Used by the buyer verification portal (US-B01).
   */
  async proveInclusion(options: ProveInclusionOptions): Promise<InclusionProof> {
    const { blobName, accountAddress, filePath, fileData } = options;

    const meta = await this.fetchMerkleTreeMeta(blobName, accountAddress);
    return proveInclusion(meta, filePath, fileData);
  }

  // ─── Public: download ────────────────────────────────────────────────────

  /**
   * Download and decrypt a committed source archive from Shelby.
   * Returns the decrypted zip archive buffer.
   *
   * Called by the buyer after a trigger fires and they receive the
   * encryption key from the Aptos smart contract event.
   */
  async download(options: DownloadOptions): Promise<Buffer> {
    const { blobName, accountAddress, encryptionKey, iv, authTag } = options;

    let ciphertext: Buffer;
    try {
      const blob = await this.shelby.download({
        account: AccountAddress.from(accountAddress),
        blobName,
      });
      ciphertext = await this.streamToBuffer(blob.readable as ReadableStream<Uint8Array>);
    } catch (err) {
      throw new ShelbyDownloadError(
        `Failed to download blob "${blobName}" from account ${accountAddress}: ${String(err)}`,
        err,
      );
    }

    return decryptBlob(ciphertext, encryptionKey, iv, authTag);
  }

  // ─── Public: list commits ────────────────────────────────────────────────

  /**
   * List all blobs (commits) for this client's Shelby account.
   * Meta blobs (ending in __meta) are filtered out.
   */
  async listCommits(): Promise<BlobInfo[]> {
    const blobs = await this.shelby.coordination.getAccountBlobs({
      account: this.signer.accountAddress,
    });

    return blobs
      .filter((b: { name: string }) => !b.name.endsWith(META_SUFFIX))
      .map((b: { name: string; size: number; expirationMicros: number }) => ({
        blobName: b.name,
        size: b.size,
        expirationMicros: b.expirationMicros,
      }));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Extract all files from a zip archive buffer.
   * Directories and __MACOSX entries are skipped.
   */
  private async extractArchive(
    archiveData: Buffer,
  ): Promise<Array<{ path: string; data: Buffer }>> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(archiveData);
    } catch (err) {
      throw new ArchiveError(
        `Failed to parse archive. Ensure the data is a valid zip file. ${String(err)}`,
      );
    }

    const files: Array<{ path: string; data: Buffer }> = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (path.startsWith('__MACOSX/') || path.includes('/.DS_Store')) continue;
      const data = await entry.async('nodebuffer');
      files.push({ path, data });
    }

    if (files.length === 0) {
      throw new ArchiveError('Archive contains no files after filtering.');
    }

    return files;
  }

  /**
   * Fetch the Merkle tree metadata blob for a given commit.
   * This blob is public (unencrypted) and contains the full tree structure.
   */
  private async fetchMerkleTreeMeta(
    blobName: string,
    accountAddress: string,
  ): Promise<MerkleTreeMeta> {
    const metaBlobName = `${blobName}${META_SUFFIX}`;
    let raw: Buffer;

    try {
      const blob = await this.shelby.download({
        account: AccountAddress.from(accountAddress),
        blobName: metaBlobName,
      });
      raw = await this.streamToBuffer(blob.readable as ReadableStream<Uint8Array>);
    } catch (err) {
      throw new ShelbyDownloadError(
        `Failed to download Merkle metadata for "${blobName}": ${String(err)}`,
        err,
      );
    }

    try {
      return JSON.parse(raw.toString('utf8')) as MerkleTreeMeta;
    } catch {
      throw new ShelbyDownloadError(
        `Merkle metadata blob for "${blobName}" is not valid JSON.`,
      );
    }
  }

  /**
   * Attempt to retrieve Shelby's own Merkle root from blob metadata.
   * Returns an empty string if unavailable (non-critical for Phase 1).
   */
  private async fetchShelbyMerkleRoot(blobName: string): Promise<string> {
    try {
      const blobs = await this.shelby.coordination.getAccountBlobs({
        account: this.signer.accountAddress,
      });
      const entry = blobs.find(
        (b: { name: string; merkleRoot?: string }) => b.name === blobName,
      );
      return entry?.merkleRoot ?? '';
    } catch {
      return '';
    }
  }

  private async streamToBuffer(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
}
