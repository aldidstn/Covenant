'use client';

import { useState } from 'react';
import { fetchAgreementOnChain } from '@/lib/aptos';
import {
  proveInclusionFromMeta,
  verifyInclusionProof,
  type MerkleTreeMeta,
  type BrowserInclusionProof,
} from '@/lib/merkle-browser';
import {
  unwrapKeyBrowser,
  decryptArchiveBrowser,
} from '@/lib/keyexchange-browser';
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

function MonoInput({
  label, value, onChange, placeholder, type = 'text', hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-brand/50 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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
      const valid = proof.included ? await verifyInclusionProof(proof, expectedRoot) : false;
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
          required rows={5}
          placeholder='Paste the contents of "{blobName}__meta" from Shelby…'
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-brand/50 focus:outline-none resize-y"
        />
        <p className="mt-1 text-xs text-slate-500">
          Ask the vendor to share the <code className="text-slate-400">__meta</code> blob, or fetch it from Shelby using the blob coordinates.
        </p>
      </div>

      <MonoInput
        label="File path (as committed) *"
        value={filePath}
        onChange={setFilePath}
        placeholder="src/index.ts"
      />

      <div>
        <label className="mb-1 block text-xs text-slate-400">File content *</label>
        <textarea
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          required rows={6}
          placeholder="Paste the exact file content to verify…"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-brand/50 focus:outline-none resize-y"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Verifying…' : 'Verify Inclusion'}
      </button>

      {result && (
        <div className={`rounded-lg border p-4 space-y-2 ${result.valid ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
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

// ─── Zip file viewer ──────────────────────────────────────────────────────────

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

function ZipViewer({ entries }: { entries: ZipEntry[] }) {
  const [selected, setSelected] = useState<ZipEntry | null>(null);
  const [textCache, setTextCache] = useState<Map<string, string>>(new Map());

  function getTextContent(entry: ZipEntry): string {
    if (textCache.has(entry.path)) return textCache.get(entry.path)!;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
      setTextCache((prev) => new Map(prev).set(entry.path, text));
      return text;
    } catch {
      return '[binary file — download to view]';
    }
  }

  function downloadEntry(entry: ZipEntry) {
    const ab = new ArrayBuffer(entry.data.byteLength);
    new Uint8Array(ab).set(entry.data);
    const blob = new Blob([ab]);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = entry.path.split('/').pop() ?? entry.path;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAll(allEntries: ZipEntry[]) {
    // Re-pack into a zip and download — requires JSZip which is already a dep of the SDK.
    // We do a simple sequential download instead to avoid adding another import.
    for (const entry of allEntries) downloadEntry(entry);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{entries.length} file(s) in archive</p>
        <button
          type="button"
          onClick={() => downloadAll(entries)}
          className="btn-ghost text-xs"
        >
          Download all
        </button>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface overflow-hidden">
        {/* File list */}
        <div className="divide-y divide-surface-border max-h-48 overflow-y-auto">
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setSelected(entry)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors ${selected?.path === entry.path ? 'bg-brand/10 text-brand' : 'text-slate-300 font-mono'}`}
            >
              <span className="truncate">{entry.path}</span>
              <span className="text-slate-600 shrink-0 ml-2">{(entry.data.length / 1024).toFixed(1)} KB</span>
            </button>
          ))}
        </div>

        {/* File preview */}
        {selected && (
          <div className="border-t border-surface-border">
            <div className="flex items-center justify-between px-3 py-2 bg-surface-card border-b border-surface-border">
              <span className="font-mono text-xs text-slate-400 truncate">{selected.path}</span>
              <button
                type="button"
                onClick={() => downloadEntry(selected)}
                className="text-xs text-brand hover:underline shrink-0 ml-2"
              >
                Download
              </button>
            </div>
            <pre className="px-3 py-3 text-xs text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
              {getTextContent(selected)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── In-browser decrypt panel ─────────────────────────────────────────────────

function DecryptPortal() {
  const [privateSeed, setPrivateSeed] = useState('');
  const [encryptedKey, setEncryptedKey] = useState('');
  const [shelbyBlobUrl, setShelbyBlobUrl] = useState('');
  const [ivHex, setIvHex] = useState('');
  const [authTagHex, setAuthTagHex] = useState('');
  const [entries, setEntries] = useState<ZipEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function decrypt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setEntries(null);
    try {
      // 1. Unwrap the archive key from the on-chain encrypted_key.
      setStatus('Unwrapping archive key…');
      const { archiveKey } = await unwrapKeyBrowser(privateSeed, encryptedKey);

      // 2. Fetch the encrypted blob from Shelby.
      setStatus('Fetching encrypted blob from Shelby…');
      const resp = await fetch(shelbyBlobUrl);
      if (!resp.ok) throw new Error(`Blob fetch failed: ${resp.status} ${resp.statusText}`);
      const ciphertextBuffer = await resp.arrayBuffer();
      const ciphertextBytes  = new Uint8Array(ciphertextBuffer);

      // 3. Decrypt.
      setStatus('Decrypting archive…');
      const plaintext = await decryptArchiveBrowser(archiveKey, ciphertextBytes, ivHex, authTagHex);

      // 4. Parse zip.
      setStatus('Parsing zip archive…');
      const JSZip = (await import('jszip')).default;
      const zip   = await JSZip.loadAsync(plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer);

      const extracted: ZipEntry[] = [];
      for (const [path, file] of Object.entries(zip.files) as [string, import('jszip').JSZipObject][]) {
        if (file.dir) continue;
        if (path.startsWith('__MACOSX/') || path.includes('/.DS_Store')) continue;
        const data = await file.async('uint8array');
        extracted.push({ path, data });
      }

      setEntries(extracted);
      setStatus('');
    } catch (ex) {
      setError(String(ex));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300 space-y-1">
        <p className="font-medium text-red-400">How to get these values</p>
        <ol className="list-decimal list-inside space-y-1 text-red-400/80">
          <li>Find the <code>TriggerExecuted</code> event for this agreement on the Aptos explorer.</li>
          <li>Copy <code>encrypted_key</code>, <code>iv</code>, and <code>auth_tag</code> from the event data.</li>
          <li>The Shelby blob URL is: <code>https://&lt;shelby-node&gt;/blob/&lt;accountAddress&gt;/&lt;blobName&gt;</code></li>
          <li>Your private seed is the raw 32-byte hex Ed25519 key for the buyer address registered on the agreement.</li>
        </ol>
      </div>

      <form onSubmit={decrypt} className="space-y-4">
        <MonoInput
          label="Your Ed25519 private seed (hex, 64 chars) *"
          value={privateSeed}
          onChange={setPrivateSeed}
          placeholder="0x… or hex without prefix"
          type="password"
          hint="Never sent anywhere — all decryption runs locally in your browser."
        />
        <MonoInput
          label="Encrypted key from TriggerExecuted event (hex, 144 chars) *"
          value={encryptedKey}
          onChange={setEncryptedKey}
          placeholder="0x… (72-byte packed blob)"
        />
        <MonoInput
          label="Shelby blob URL *"
          value={shelbyBlobUrl}
          onChange={setShelbyBlobUrl}
          placeholder="https://shelby-node/blob/0x…/blobName"
        />
        <div className="grid grid-cols-2 gap-3">
          <MonoInput
            label="IV (hex, 24 chars) *"
            value={ivHex}
            onChange={setIvHex}
            placeholder="12-byte IV"
          />
          <MonoInput
            label="Auth tag (hex, 32 chars) *"
            value={authTagHex}
            onChange={setAuthTagHex}
            placeholder="16-byte auth tag"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {status && <p className="text-xs text-brand animate-pulse">{status}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Decrypting…' : 'Decrypt & View Archive'}
        </button>
      </form>

      {entries && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-400 font-medium">✓ Decrypted successfully</span>
          </div>
          <ZipViewer entries={entries} />
        </div>
      )}
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
          Look up any escrow agreement, verify file inclusion, and decrypt the released archive.
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
        </Section>
      )}

      {/* Step 3 — File verification (active agreements) */}
      {chainInfo && stateNum !== 2 && chainInfo.merkleRoot && (
        <Section title="File Inclusion Proof">
          <p className="text-xs text-slate-500">
            Verify that a specific file was part of the committed source archive without downloading the encrypted blob.
          </p>
          <MerkleVerifier expectedRoot={chainInfo.merkleRoot} />
        </Section>
      )}

      {/* Step 4 — In-browser decrypt (triggered agreements only) */}
      {chainInfo && stateNum === 2 && (
        <Section title="Decrypt Released Archive">
          <p className="text-xs text-slate-500">
            The trigger has fired. Use your Ed25519 private key to unwrap the encryption key and
            decrypt the source archive directly in your browser — no server required.
          </p>
          <DecryptPortal />
        </Section>
      )}

      {/* No merkle root yet */}
      {chainInfo && stateNum !== 2 && !chainInfo.merkleRoot && (
        <Section title="File Inclusion Proof">
          <p className="text-sm text-slate-500 italic">
            No code has been committed to this agreement yet. Ask the vendor to push a release tag.
          </p>
        </Section>
      )}
    </div>
  );
}
