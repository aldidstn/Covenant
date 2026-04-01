'use client';

import { useState } from 'react';
import { fetchAgreementOnChain } from '@/lib/aptos';
import {
  proveInclusionFromMeta,
  verifyInclusionProof,
  type MerkleTreeMeta,
  type BrowserInclusionProof,
} from '@/lib/merkle-browser';
import { STATE_LABEL, STATE_CLASS, GRACE_PERIOD_SECONDS } from '@/lib/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right text-slate-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

// ─── Agreement lookup ─────────────────────────────────────────────────────────

interface ChainInfo {
  state: number;
  merkleRoot: string;
  expiryTimestamp: number;
  lastCommitAt: number;
  eolNoticeAt: number;
  triggerMet: boolean;
}

function AgreementLookup({ onLoaded }: { onLoaded: (id: number, info: ChainInfo) => void }) {
  const [agreementId, setAgreementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(agreementId, 10);
    if (!id || id <= 0) return;
    setBusy(true);
    setError('');
    try {
      const data = await fetchAgreementOnChain(id);
      onLoaded(id, {
        state: data.state,
        merkleRoot: data.merkleRoot,
        expiryTimestamp: data.timestamps.expiryTimestamp,
        lastCommitAt: data.timestamps.lastCommitAt,
        eolNoticeAt: data.timestamps.eolNoticeAt,
        triggerMet: data.triggerMet,
      });
    } catch {
      setError('Agreement not found or network error. Check the ID and your node URL in .env.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={lookup} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-slate-400">Agreement ID</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={agreementId}
            onChange={(e) => setAgreementId(e.target.value)}
            placeholder="e.g. 1"
            required
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-brand/50 focus:outline-none"
          />
          <button type="submit" disabled={busy} className="btn-primary shrink-0">
            {busy ? 'Loading…' : 'Look up'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}

// ─── Merkle verification panel ────────────────────────────────────────────────

function MerkleVerifier({ expectedRoot }: { expectedRoot: string }) {
  const [metaJson, setMetaJson] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [result, setResult] = useState<{ proof: BrowserInclusionProof; valid: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      let meta: MerkleTreeMeta;
      try {
        meta = JSON.parse(metaJson) as MerkleTreeMeta;
      } catch {
        throw new Error('Invalid __meta JSON. Paste the full contents of the __meta blob.');
      }
      const fileBytes = new TextEncoder().encode(fileContent);
      const proof = await proveInclusionFromMeta(meta, filePath, fileBytes);
      const valid = proof.included
        ? await verifyInclusionProof(proof, expectedRoot)
        : false;
      setResult({ proof, valid });
    } catch (ex) {
      setError(String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3">
        <p className="text-xs text-slate-500 mb-1">Expected Merkle root (from chain)</p>
        <p className="font-mono text-xs text-slate-400 break-all">{expectedRoot || '—'}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">__meta blob JSON *</label>
        <textarea
          value={metaJson}
          onChange={(e) => setMetaJson(e.target.value)}
          required
          rows={5}
          placeholder='Paste the contents of "{blobName}__meta" from Shelby…'
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-brand/50 focus:outline-none resize-y"
        />
        <p className="mt-1 text-xs text-slate-500">
          Ask the vendor to share the <code className="text-slate-400">__meta</code> blob, or fetch it from Shelby using the blob coordinates.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">File path (as committed) *</label>
        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          required
          placeholder="src/index.ts"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-brand/50 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">File content *</label>
        <textarea
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          required
          rows={6}
          placeholder="Paste the exact file content to verify…"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-brand/50 focus:outline-none resize-y"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Verifying…' : 'Verify Inclusion'}
      </button>

      {result && (
        <div className={`rounded-lg border p-4 space-y-2 ${
          result.valid
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-red-500/30 bg-red-500/10'
        }`}>
          <p className={`font-semibold text-sm ${result.valid ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.valid ? '✓ Inclusion verified' : '✗ Not in committed tree'}
          </p>
          <div className="space-y-1 text-xs">
            <p className="text-slate-400">File path: <span className="font-mono text-slate-300">{result.proof.filePath}</span></p>
            <p className="text-slate-400">Leaf hash: <span className="font-mono text-slate-300 break-all">{result.proof.fileHash}</span></p>
            <p className="text-slate-400">Proof steps: <span className="text-slate-300">{result.proof.proof.length}</span></p>
          </div>
        </div>
      )}
    </form>
  );
}

// ─── Triggered — key release instructions ────────────────────────────────────

function TriggerInfo() {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-2 text-sm">
      <p className="font-medium text-red-400">⚡ Trigger has fired — source code is released</p>
      <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs">
        <li>Check the Aptos explorer for the <code>TriggerExecuted</code> event on this agreement.</li>
        <li>Copy the <code>encrypted_key</code>, <code>iv</code>, and <code>auth_tag</code> from the event.</li>
        <li>Decrypt <code>encrypted_key</code> using your Aptos private key (the buyer key registered at agreement creation).</li>
        <li>Use the VaultLayer SDK's <code>download()</code> to fetch and decrypt the source archive from Shelby:</li>
      </ol>
      <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 text-xs text-slate-300">
{`import { VaultLayerClient } from '@vaultlayer/sdk';

const client = new VaultLayerClient({ shelbyPrivateKey: '…' });
const archive = await client.download({
  blobName: '<blob_name from event>',
  accountAddress: '<shelby_account from event>',
  encryptionKey: Buffer.from('<decrypted AES key>', 'hex'),
  iv: '<iv from event>',
  authTag: '<auth_tag from event>',
});
// archive is a Buffer containing the zip file`}
      </pre>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuyerPortal() {
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null);

  function handleLoaded(id: number, info: ChainInfo) {
    setAgreementId(id);
    setChainInfo(info);
  }

  const stateNum = chainInfo?.state ?? 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Buyer Verification Portal</h1>
        <p className="text-sm text-slate-400 mt-1">
          Look up any escrow agreement and verify file inclusion against the on-chain Merkle root.
        </p>
      </div>

      {/* Step 1 — Lookup */}
      <Section title="Agreement Lookup">
        <AgreementLookup onLoaded={handleLoaded} />
      </Section>

      {/* Step 2 — On-chain state */}
      {chainInfo && agreementId !== null && (
        <Section title={`Agreement #${agreementId}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATE_CLASS[stateNum]}`}>
              {STATE_LABEL[stateNum] ?? 'Unknown'}
            </span>
            {chainInfo.triggerMet && stateNum === 1 && (
              <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                ⚡ Trigger condition met
              </span>
            )}
          </div>

          <div className="space-y-2">
            <InfoRow label="Expiry" value={formatDate(chainInfo.expiryTimestamp)} />
            <InfoRow label="Last commit" value={chainInfo.lastCommitAt ? formatDate(chainInfo.lastCommitAt) : '—'} />
            {chainInfo.eolNoticeAt > 0 && (
              <InfoRow
                label="EOL trigger after"
                value={formatDate(chainInfo.eolNoticeAt + GRACE_PERIOD_SECONDS)}
              />
            )}
            <InfoRow label="Content Merkle root" value={chainInfo.merkleRoot || '(none committed yet)'} mono />
          </div>

          {stateNum === 2 && <TriggerInfo />}
        </Section>
      )}

      {/* Step 3 — File verification */}
      {chainInfo && stateNum !== 2 && (
        <Section title="File Inclusion Proof">
          <p className="text-xs text-slate-500">
            Verify that a specific file was part of the committed source archive without downloading the encrypted blob.
          </p>
          {chainInfo.merkleRoot ? (
            <MerkleVerifier expectedRoot={chainInfo.merkleRoot} />
          ) : (
            <p className="text-sm text-slate-500 italic">
              No code has been committed to this agreement yet. Ask the vendor to push a release tag.
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
