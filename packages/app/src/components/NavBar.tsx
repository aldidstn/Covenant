'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './WalletButton';

const LINKS = [
  { href: '/vendor', label: 'Vendor' },
  { href: '/buyer', label: 'Buyer' },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-surface-border bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-brand font-mono text-lg font-bold tracking-tight">
            VaultLayer
          </span>
          <span className="rounded bg-brand/10 px-1.5 py-0.5 text-xs font-mono text-brand border border-brand/20">
            MVP
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-surface-card text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <WalletButton />
      </div>
    </nav>
  );
}
