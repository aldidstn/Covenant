'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { fetchRegistryPage, type RegistryEntry } from '@/lib/aptos';
import { STATE_LABEL, STATE_CLASS } from '@/lib/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function formatDate(unixSec: number): string {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function StateBadge({ state }: { state: number }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'}`}>
      {STATE_LABEL[state] ?? 'Unknown'}
    </span>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

function AgreementRow({ entry }: { entry: RegistryEntry }) {
  return (
    <tr className="border-b border-surface-border hover:bg-surface-hover transition-colors">
      <td className="px-4 py-3 font-mono text-sm text-slate-300">
        <Link href={`/buyer?id=${entry.id}`} className="hover:text-brand transition-colors">
          #{entry.id}
        </Link>
      </td>
      <td className="px-4 py-3">
        <StateBadge state={entry.state} />
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {formatDate(entry.expiryTimestamp)}
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {formatDate(entry.lastCommitAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/buyer?id=${entry.id}`}
          className="text-xs text-brand hover:underline"
        >
          Verify →
        </Link>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegistryPage() {
  const [entries, setEntries]       = useState<RegistryEntry[]>([]);
  const [nextFromId, setNextFromId] = useState<number | null>(1);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [initialized, setInitialized] = useState(false);

  const loadPage = useCallback(async (fromId: number, replace: boolean) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchRegistryPage(fromId, PAGE_SIZE);
      setEntries((prev) => replace ? result.entries : [...prev, ...result.entries]);
      setNextFromId(result.nextFromId);
    } catch (ex) {
      setError(String(ex));
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    loadPage(1, true);
  }, [loadPage]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Public Escrow Registry</h1>
          <p className="text-sm text-slate-400 mt-1">
            All escrow agreements deployed on the Covenant contract. No wallet required.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadPage(1, true)}
          disabled={loading}
          className="btn-ghost text-xs"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-surface-border bg-surface-card overflow-x-auto">
        {entries.length === 0 && initialized && !loading ? (
          <div className="px-6 py-12 text-center text-slate-500 text-sm">
            No escrow agreements found on this contract.
          </div>
        ) : (
          <table className="w-full min-w-[600px] text-left">
            <thead>
              <tr className="border-b border-surface-border bg-surface">
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">State</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Expiry</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Last Commit</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AgreementRow key={entry.id} entry={entry} />
              ))}
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skel-${i}`} className="border-b border-surface-border animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 w-8 rounded bg-surface-border" /></td>
                  <td className="px-4 py-3"><div className="h-5 w-16 rounded bg-surface-border" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-surface-border" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-surface-border" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-12 rounded bg-surface-border ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <p className="text-slate-500 text-xs">
          Showing {entries.length} agreement{entries.length !== 1 ? 's' : ''}
        </p>
        {nextFromId !== null && (
          <button
            type="button"
            onClick={() => loadPage(nextFromId, false)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {nextFromId === null && entries.length > 0 && (
          <p className="text-xs text-slate-600">All agreements loaded</p>
        )}
      </div>
    </div>
  );
}
