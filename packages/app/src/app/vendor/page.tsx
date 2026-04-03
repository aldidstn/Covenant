'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchAgreementOnChain } from '@/lib/aptos';
import { getAgreements, saveAgreement, removeAgreement, type AgreementMeta } from '@/lib/storage';
import { STATE_LABEL, STATE_CLASS, GRACE_PERIOD_SECONDS } from '@/lib/constants';

// ─── Focus trap hook ─────────────────────────────────────────────────────────

function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first focusable element
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);

  return ref;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgreementRow extends AgreementMeta {
  state?: number;
  merkleRoot?: string;
  expiryTimestamp?: number;
  lastCommitAt?: number;
  eolNoticeAt?: number;
  triggerMet?: boolean;
  loading: boolean;
  error?: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatRelative(unixSec: number): string {
  const diff = unixSec - Math.floor(Date.now() / 1000);
  if (diff === 0) return 'now';
  const abs = Math.abs(diff);
  const suffix = diff > 0 ? '' : ' ago';
  const prefix = diff > 0 ? 'in ' : '';
  if (abs < 60) return `${prefix}${abs}s${suffix}`;
  if (abs < 3600) return `${prefix}${Math.floor(abs / 60)}m${suffix}`;
  if (abs < 86400) return `${prefix}${Math.floor(abs / 3600)}h${suffix}`;
  return `${prefix}${Math.floor(abs / 86400)}d${suffix}`;
}

function freshnessClass(lastCommitAt: number): string {
  const ageDays = (Date.now() / 1000 - lastCommitAt) / 86400;
  if (ageDays < 7) return 'text-emerald-400';
  if (ageDays < 30) return 'text-yellow-400';
  return 'text-red-400';
}

// ─── Add-agreement dialog ─────────────────────────────────────────────────────

function AddAgreementForm({
  onAdd,
  onClose,
}: {
  onAdd: (meta: AgreementMeta) => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap(true);
  const [form, setForm] = useState({
    id: '',
    label: '',
    blobName: '',
    buyerAddress: '',
    shelbyAccount: '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(form.id, 10);
    if (!id || id <= 0) return;
    onAdd({
      id,
      label: form.label || `Agreement #${id}`,
      blobName: form.blobName,
      buyerAddress: form.buyerAddress,
      shelbyAccount: form.shelbyAccount,
      createdAt: Date.now(),
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-dialog-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={trapRef}>
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-xl border border-surface-border bg-surface-card p-6 shadow-2xl"
        >
          <h2 id="add-dialog-title" className="mb-4 text-lg font-semibold text-slate-100">Track Agreement</h2>
          <div className="space-y-3">
            <Field label="Agreement ID *" type="number" value={form.id} onChange={(v) => setForm((f) => ({ ...f, id: v }))} required />
            <Field label="Label" value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} placeholder="MyApp — Acme Corp" />
            <Field label="Blob name" value={form.blobName} onChange={(v) => setForm((f) => ({ ...f, blobName: v }))} placeholder="acme/myapp/v1.0.0" />
            <Field label="Buyer address" value={form.buyerAddress} onChange={(v) => setForm((f) => ({ ...f, buyerAddress: v }))} placeholder="0x…" />
            <Field label="Shelby account" value={form.shelbyAccount} onChange={(v) => setForm((f) => ({ ...f, shelbyAccount: v }))} placeholder="0x… (your Shelby/Aptos address)" />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text', required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <input
        type={type} value={value} required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-brand/50 focus:outline-none"
      />
    </label>
  );
}

// ─── Agreement card ───────────────────────────────────────────────────────────

function AgreementCard({
  row,
  onRemove,
  onAction,
}: {
  row: AgreementRow;
  onRemove: () => void;
  onAction: (action: 'renew' | 'eol' | 'trigger') => void;
}) {
  const stateNum = row.state ?? 0;

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-500">#{row.id}</span>
            <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${STATE_CLASS[stateNum]}`}>
              {STATE_LABEL[stateNum] ?? 'Unknown'}
            </span>
            {row.triggerMet && stateNum === 1 && (
              <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-400">
                ⚡ Trigger ready
              </span>
            )}
          </div>
          <p className="mt-1 font-medium text-slate-200">{row.label}</p>
          {row.blobName && (
            <p className="font-mono text-xs text-slate-500 mt-0.5">{row.blobName}</p>
          )}
        </div>
        <button onClick={onRemove} aria-label={`Remove agreement #${row.id}`} className="text-slate-600 hover:text-slate-400 text-xs">✕</button>
      </div>

      {row.loading && (
        <div className="space-y-3 animate-pulse">
          <div className="grid grid-cols-3 gap-3">
            <div><div className="h-3 w-12 rounded bg-surface-border mb-1.5" /><div className="h-4 w-16 rounded bg-surface-border" /></div>
            <div><div className="h-3 w-12 rounded bg-surface-border mb-1.5" /><div className="h-4 w-16 rounded bg-surface-border" /></div>
            <div><div className="h-3 w-12 rounded bg-surface-border mb-1.5" /><div className="h-4 w-16 rounded bg-surface-border" /></div>
          </div>
          <div className="h-3 w-48 rounded bg-surface-border" />
        </div>
      )}

      {row.error && (
        <p className="text-xs text-red-400">{row.error}</p>
      )}

      {!row.loading && !row.error && row.expiryTimestamp !== undefined && (
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="Expires" value={formatRelative(row.expiryTimestamp)}
            cls={row.expiryTimestamp < Date.now() / 1000 ? 'text-red-400' : 'text-slate-300'} />
          <Stat label="Last commit"
            value={row.lastCommitAt ? formatRelative(row.lastCommitAt) : '—'}
            cls={row.lastCommitAt ? freshnessClass(row.lastCommitAt) : 'text-slate-500'} />
          <Stat label="EOL notice"
            value={row.eolNoticeAt ? formatRelative(row.eolNoticeAt + GRACE_PERIOD_SECONDS) : 'None'}
            cls={row.eolNoticeAt ? 'text-orange-400' : 'text-slate-500'} />
        </div>
      )}

      {!row.loading && !row.error && row.merkleRoot && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Content Merkle root</p>
          <p className="font-mono text-xs text-slate-400 break-all">{row.merkleRoot || '—'}</p>
        </div>
      )}

      {/* Actions (only for active agreements) */}
      {stateNum === 1 && !row.loading && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => onAction('renew')} className="btn-ghost text-xs">Renew</button>
          {!row.eolNoticeAt && (
            <button onClick={() => onAction('eol')} className="btn-ghost text-xs text-orange-400">Notify EOL</button>
          )}
          {row.triggerMet && (
            <button onClick={() => onAction('trigger')} className="btn-primary text-xs">Execute Trigger</button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="text-slate-500 mb-0.5">{label}</p>
      <p className={`font-mono font-medium ${cls ?? 'text-slate-300'}`}>{value}</p>
    </div>
  );
}

// ─── Action modals (Renew / EOL / Trigger) ────────────────────────────────────

function ActionModal({
  action,
  agreementId,
  onClose,
  onConfirm,
}: {
  action: 'renew' | 'eol' | 'trigger';
  agreementId: number;
  onClose: () => void;
  onConfirm: (payload: Record<string, string>) => Promise<void>;
}) {
  const trapRef = useFocusTrap(true);
  const [newExpiry, setNewExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await onConfirm({ newExpiry });
      onClose();
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  }

  const titles = { renew: 'Renew Agreement', eol: 'Notify End-of-Life', trigger: 'Execute Trigger' };
  const descriptions = {
    renew: `Extend agreement #${agreementId}'s expiry. The new date must be after the current one.`,
    eol: `Signal end-of-life for agreement #${agreementId}. The buyer will be able to access the source after a 48-hour grace period.`,
    trigger: `Execute the trigger for agreement #${agreementId}. This releases the encrypted key on-chain. It is permissionless — anyone can call it once conditions are met.`,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-dialog-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div ref={trapRef}>
        <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-surface-border bg-surface-card p-6 shadow-2xl space-y-4">
          <h2 id="action-dialog-title" className="text-lg font-semibold text-slate-100">{titles[action]}</h2>
          <p className="text-sm text-slate-400">{descriptions[action]}</p>

          {action === 'renew' && (
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">New expiry date</span>
              <input
                type="datetime-local"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                required
                className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-slate-200 focus:border-brand/50 focus:outline-none"
              />
            </label>
          )}

          {err && <p className="text-xs text-red-400" role="alert">{err}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className={action === 'eol' ? 'btn-warning' : 'btn-primary'}>
              {busy ? 'Sending…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorDashboard() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [activeAction, setActiveAction] = useState<{
    action: 'renew' | 'eol' | 'trigger';
    id: number;
  } | null>(null);

  // Load local agreements then hydrate with on-chain data
  const load = useCallback(() => {
    if (!account?.address) return;
    const metas = getAgreements(account.address.toString());
    setRows(metas.map((m) => ({ ...m, loading: true })));

    metas.forEach(async (m) => {
      try {
        const chain = await fetchAgreementOnChain(m.id);
        setRows((prev) =>
          prev.map((r) =>
            r.id === m.id
              ? {
                  ...r,
                  loading: false,
                  state: chain.state,
                  merkleRoot: chain.merkleRoot,
                  expiryTimestamp: chain.timestamps.expiryTimestamp,
                  lastCommitAt: chain.timestamps.lastCommitAt,
                  eolNoticeAt: chain.timestamps.eolNoticeAt,
                  triggerMet: chain.triggerMet,
                }
              : r,
          ),
        );
      } catch {
        setRows((prev) =>
          prev.map((r) =>
            r.id === m.id ? { ...r, loading: false, error: 'Failed to load from chain' } : r,
          ),
        );
      }
    });
  }, [account?.address]);

  useEffect(() => { load(); }, [load]);

  function handleAdd(meta: AgreementMeta) {
    if (!account?.address) return;
    saveAgreement(account.address.toString(), meta);
    load();
  }

  function handleRemove(id: number) {
    if (!account?.address) return;
    removeAgreement(account.address.toString(), id);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  async function handleAction(action: 'renew' | 'eol' | 'trigger', id: number, payload: Record<string, string>) {
    const { CONTRACT_ADDRESS } = await import('@/lib/constants');
    let functionName: string;
    let args: (string | number)[];

    if (action === 'renew') {
      const newExpirySec = Math.floor(new Date(payload.newExpiry).getTime() / 1000);
      functionName = 'renew';
      args = [id.toString(), newExpirySec.toString()];
    } else if (action === 'eol') {
      functionName = 'notify_eol';
      args = [id.toString()];
    } else {
      functionName = 'execute_trigger';
      args = [id.toString()];
    }

    await signAndSubmitTransaction({
      data: {
        function: `${CONTRACT_ADDRESS}::escrow::${functionName}`,
        functionArguments: args,
      },
    });

    // Refresh the card
    setTimeout(() => load(), 2000);
  }

  if (!connected || !account) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl" aria-hidden="true">🔒</div>
        <p className="text-slate-300 font-medium">Connect your wallet to view your escrow agreements.</p>
        <p className="text-sm text-slate-500">Your agreements are loaded from the Aptos blockchain using your wallet address.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Vendor Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your software escrow agreements.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="btn-ghost text-sm">Track ID</button>
          <Link href="/vendor/new" className="btn-primary text-sm">+ New Agreement</Link>
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-surface-border bg-surface-card/50 py-16 text-center">
          <p className="text-slate-400 font-medium">No agreements tracked yet.</p>
          <p className="text-sm text-slate-500 mt-1">
            <Link href="/vendor/new" className="text-brand hover:underline">Create your first agreement</Link>{' '}
            or use "Track ID" to import an existing one.
          </p>
        </div>
      )}

      {/* Agreement cards */}
      <div className="space-y-4">
        {rows.map((row) => (
          <AgreementCard
            key={row.id}
            row={row}
            onRemove={() => handleRemove(row.id)}
            onAction={(action) => setActiveAction({ action, id: row.id })}
          />
        ))}
      </div>

      {showAdd && (
        <AddAgreementForm
          onAdd={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      {activeAction && (
        <ActionModal
          action={activeAction.action}
          agreementId={activeAction.id}
          onClose={() => setActiveAction(null)}
          onConfirm={(payload) => handleAction(activeAction.action, activeAction.id, payload)}
        />
      )}
    </div>
  );
}
