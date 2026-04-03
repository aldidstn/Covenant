'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useState, useRef, useEffect, useCallback } from 'react';

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const { account, connected, connect, disconnect, wallets } = useWallet();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, close]);

  if (connected && account) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-mono text-slate-300 hover:border-brand/50 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          {truncate(account.address.toString())}
        </button>

        {open && (
          <div role="menu" className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-surface-border bg-surface-card shadow-xl">
            <div className="px-3 py-2 text-xs text-slate-500 font-mono border-b border-surface-border">
              {truncate(account.address.toString())}
            </div>
            <button
              role="menuitem"
              onClick={() => { disconnect(); setOpen(false); }}
              className="w-full px-3 py-2 text-sm text-left text-red-400 hover:bg-surface-hover transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-light transition-colors"
      >
        Connect Wallet
      </button>

      {open && wallets && wallets.length > 0 && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-surface-border bg-surface-card shadow-xl">
          <div className="px-3 py-2 text-xs text-slate-500 border-b border-surface-border">
            Select wallet
          </div>
          {wallets.map((w) => (
            <button
              key={w.name}
              role="menuitem"
              onClick={() => { connect(w.name); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-surface-hover transition-colors"
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt={w.name} width={16} height={16} className="h-4 w-4" />
              )}
              {w.name}
            </button>
          ))}
        </div>
      )}

      {open && (!wallets || wallets.length === 0) && (
        <div role="status" className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-surface-border bg-surface-card shadow-xl px-3 py-3 text-sm text-slate-400">
          No wallets detected. Install{' '}
          <a
            href="https://petra.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            Petra
          </a>{' '}
          to continue.
        </div>
      )}
    </div>
  );
}
