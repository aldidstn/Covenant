import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight text-slate-100">
        Cove<span className="text-brand">nant</span>
      </h1>
      <p className="mt-4 max-w-md text-slate-400">
        Trustless software escrow built on{' '}
        <span className="text-slate-300 font-medium">Shelby Protocol</span> and{' '}
        <span className="text-slate-300 font-medium">Aptos</span>. Cryptographic, continuous,
        self-verifying — no intermediaries.
      </p>

      <div className="mt-10 flex gap-4">
        <Link
          href="/vendor"
          className="btn-primary px-6 py-3 text-base"
        >
          Vendor Portal →
        </Link>
        <Link
          href="/buyer"
          className="btn-ghost px-6 py-3 text-base"
        >
          Buyer Portal
        </Link>
      </div>

      <div className="mt-16 grid max-w-3xl grid-cols-1 gap-6 text-left sm:grid-cols-2 md:grid-cols-3">
        <Feature
          icon="🔐"
          title="Zero-knowledge to platform"
          body="Source code is encrypted client-side with AES-256-GCM before upload. Covenant never sees your code."
        />
        <Feature
          icon="⛓"
          title="On-chain commitments"
          body="Content Merkle roots, encrypted keys, and trigger state live on Aptos — tamper-proof and publicly auditable."
        />
        <Feature
          icon="⚡"
          title="Permissionless triggers"
          body="Non-renewal and EOL triggers can be executed by anyone once conditions are met — censorship-resistant by design."
        />
      </div>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="text-2xl mb-2" role="img" aria-hidden="true">{icon}</div>
      <h3 className="font-semibold text-slate-200 mb-1">{title}</h3>
      <p className="text-sm text-slate-400">{body}</p>
    </div>
  );
}
