'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useState } from 'react';

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const { account, connected, connect, disconnect, wallets } = useWallet();
  const [open, setOpen] = useState(false);

  if (connected && account) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-mono text-slate-300 hover:border-brand/50 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {truncate(account.address.toString())}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-surface-border bg-surface-card shadow-xl">
            <div className="px-3 py-2 text-xs text-slate-500 font-mono border-b border-surface-border">
              {truncate(account.address.toString())}
            </div>
            <button
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
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-light transition-colors"
      >
        Connect Wallet
      </button>

      {open && wallets && wallets.length > 0 && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-surface-border bg-surface-card shadow-xl">
          <div className="px-3 py-2 text-xs text-slate-500 border-b border-surface-border">
            Select wallet
          </div>
          {wallets.map((w) => (
            <button
              key={w.name}
              onClick={() => { connect(w.name); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-surface-hover transition-colors"
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt={w.name} className="h-4 w-4" />
              )}
              {w.name}
            </button>
          ))}
        </div>
      )}

      {open && (!wallets || wallets.length === 0) && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-surface-border bg-surface-card shadow-xl px-3 py-3 text-sm text-slate-400">
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
