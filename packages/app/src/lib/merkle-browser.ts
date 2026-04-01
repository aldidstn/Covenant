'use client';

// Browser-compatible Merkle proof verifier (mirrors packages/sdk/src/merkle.ts).
// Uses the Web Crypto API — no Node.js imports.

export interface BrowserInclusionProof {
  included: boolean;
  filePath: string;
  fileHash: string;
  contentMerkleRoot: string;
  proof: Array<{ hash: string; position: 'left' | 'right' }>;
}

// ─── SHA-256 helpers ──────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

const enc = new TextEncoder();

// ─── Leaf hash ────────────────────────────────────────────────────────────────

/**
 * Reproduces the SDK leaf hash: SHA256( filePath + "|" + SHA256(fileContent) )
 */
export async function computeLeafHash(
  filePath: string,
  fileData: Uint8Array,
): Promise<string> {
  const contentHash = await sha256Hex(fileData);
  const payload = enc.encode(`${filePath}|${contentHash}`);
  return sha256Hex(payload);
}

// ─── Proof verification ───────────────────────────────────────────────────────

/**
 * Walk the Merkle proof from leaf to root and check it matches expectedRoot.
 */
export async function verifyInclusionProof(
  proof: BrowserInclusionProof,
  expectedRoot: string,
): Promise<boolean> {
  if (!proof.included) return false;

  let current = proof.fileHash;

  for (const step of proof.proof) {
    const left = step.position === 'left' ? step.hash : current;
    const right = step.position === 'left' ? current : step.hash;
    current = await sha256Hex(concatBytes(hexToBytes(left), hexToBytes(right)));
  }

  return current === expectedRoot;
}

// ─── Leaf lookup in a __meta blob ────────────────────────────────────────────

export interface MerkleTreeMeta {
  version: 1;
  blobName: string;
  contentMerkleRoot: string;
  leaves: Array<{ path: string; hash: string }>;
  levels: string[][];
  createdAt: number;
}

/**
 * Given parsed __meta JSON, build an inclusion proof for the requested file.
 * Returns null if the file is not in the committed tree.
 */
export async function proveInclusionFromMeta(
  meta: MerkleTreeMeta,
  filePath: string,
  fileData: Uint8Array,
): Promise<BrowserInclusionProof> {
  const fileHash = await computeLeafHash(filePath, fileData);
  const leafIdx = meta.leaves.findIndex((l) => l.path === filePath);

  if (leafIdx === -1 || meta.leaves[leafIdx].hash !== fileHash) {
    return {
      included: false,
      filePath,
      fileHash,
      contentMerkleRoot: meta.contentMerkleRoot,
      proof: [],
    };
  }

  // Walk up the tree to build the sibling proof path.
  const proofSteps: Array<{ hash: string; position: 'left' | 'right' }> = [];
  let idx = leafIdx;

  for (let level = 0; level < meta.levels.length - 1; level++) {
    const levelHashes = meta.levels[level];
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = levelHashes[siblingIdx];
    if (sibling) {
      proofSteps.push({
        hash: sibling,
        position: idx % 2 === 0 ? 'right' : 'left',
      });
    }
    idx = Math.floor(idx / 2);
  }

  return {
    included: true,
    filePath,
    fileHash,
    contentMerkleRoot: meta.contentMerkleRoot,
    proof: proofSteps,
  };
}
