import { createHash } from 'node:crypto';
import { MerkleError } from './errors.js';
import type { MerkleTreeMeta, InclusionProof } from './types.js';

// ─── Hashing helpers ─────────────────────────────────────────────────────────

function sha256(data: Buffer | string): string {
  return createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    .digest('hex');
}

function sha256pair(left: string, right: string): string {
  return createHash('sha256')
    .update(Buffer.from(left + right, 'utf8'))
    .digest('hex');
}

// ─── Leaf computation ────────────────────────────────────────────────────────

/**
 * Compute the Merkle leaf hash for a single file.
 * Leaf = SHA256( filePath + "|" + SHA256(fileContent) )
 *
 * Binding the path to the content means two files with identical contents but
 * different paths produce different leaves, preventing trivial proof forgeries.
 */
export function computeLeafHash(filePath: string, fileData: Buffer): string {
  const contentHash = sha256(fileData);
  return sha256(`${filePath}|${contentHash}`);
}

// ─── Tree construction ───────────────────────────────────────────────────────

/**
 * Build a binary Merkle tree from an ordered array of leaf hashes.
 * Leaves are sorted by file path before this is called (for determinism).
 *
 * Returns all levels from leaves (index 0) to root (last element).
 * The root is `levels[levels.length - 1][0]`.
 */
function buildTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    throw new MerkleError('Cannot build a Merkle tree with zero leaves.');
  }

  const levels: string[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      // Duplicate the last node if the level has an odd number of elements.
      const right = current[i + 1] ?? left;
      next.push(sha256pair(left, right));
    }
    levels.push(next);
    current = next;
  }

  return levels;
}

// ─── Public: build from file list ────────────────────────────────────────────

export interface FileEntry {
  path: string;
  data: Buffer;
}

/**
 * Build the full Merkle tree metadata from a list of source files.
 * Files are sorted by path so the tree is deterministic regardless of the
 * order the archive was iterated.
 */
export function buildMerkleTree(
  blobName: string,
  files: FileEntry[],
): MerkleTreeMeta {
  if (files.length === 0) {
    throw new MerkleError('Archive contains no files to build a Merkle tree from.');
  }

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const leaves = sorted.map((f) => ({
    path: f.path,
    hash: computeLeafHash(f.path, f.data),
  }));

  const levels = buildTree(leaves.map((l) => l.hash));
  const root = levels[levels.length - 1][0];

  return {
    version: 1,
    blobName,
    contentMerkleRoot: root,
    leaves,
    levels,
    createdAt: Date.now(),
  };
}

// ─── Public: prove inclusion ─────────────────────────────────────────────────

/**
 * Generate a Merkle inclusion proof for a specific file.
 *
 * @param meta   - The full MerkleTreeMeta (fetched from the __meta blob).
 * @param filePath - Relative path of the file inside the archive.
 * @param fileData - Content of the file to prove.
 * @returns InclusionProof with `included: true` and a proof path, or
 *          `included: false` if the file is not found in the tree.
 */
export function proveInclusion(
  meta: MerkleTreeMeta,
  filePath: string,
  fileData: Buffer,
): InclusionProof {
  const fileHash = computeLeafHash(filePath, fileData);
  const leafIndex = meta.leaves.findIndex((l) => l.hash === fileHash);

  const base: Omit<InclusionProof, 'included' | 'proof'> = {
    filePath,
    fileHash,
    contentMerkleRoot: meta.contentMerkleRoot,
    verifiedAt: Date.now(),
  };

  if (leafIndex === -1) {
    return { ...base, included: false, proof: [] };
  }

  // Walk up the tree collecting sibling hashes.
  const proof: InclusionProof['proof'] = [];
  let idx = leafIndex;

  for (let level = 0; level < meta.levels.length - 1; level++) {
    const nodes = meta.levels[level];
    const isRightChild = idx % 2 === 1;
    const siblingIdx = isRightChild ? idx - 1 : idx + 1;
    // Duplicate last node if sibling is out of range (odd level).
    const siblingHash = nodes[siblingIdx] ?? nodes[idx];

    proof.push({
      hash: siblingHash,
      position: isRightChild ? 'left' : 'right',
    });

    idx = Math.floor(idx / 2);
  }

  return { ...base, included: true, proof };
}

// ─── Public: verify a proof ──────────────────────────────────────────────────

/**
 * Re-derive the Merkle root from an inclusion proof and confirm it matches
 * the expected root. Use this on the buyer side when you only have the proof
 * (not the full tree).
 */
export function verifyInclusionProof(
  proof: InclusionProof,
  expectedRoot: string,
): boolean {
  if (!proof.included) return false;

  let hash = proof.fileHash;
  for (const sibling of proof.proof) {
    hash =
      sibling.position === 'left'
        ? sha256pair(sibling.hash, hash)
        : sha256pair(hash, sibling.hash);
  }
  return hash === expectedRoot;
}
