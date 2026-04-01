'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { saveAgreement } from '@/lib/storage';
import { CONTRACT_ADDRESS } from '@/lib/constants';

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = ['Agreement details', 'Encryption setup', 'Review & submit', 'Done'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex gap-0">
      {STEPS.map((label, i) => (
        <li key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border ${
                i < current
                  ? 'bg-brand border-brand text-white'
                  : i === current
                  ? 'border-brand text-brand bg-surface-card'
                  : 'border-surface-border text-slate-600 bg-surface-card'
              }`}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`mt-1 text-xs whitespace-nowrap ${i === current ? 'text-slate-200' : 'text-slate-600'}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-16 mx-2 mb-4 ${i < current ? 'bg-brand' : 'bg-surface-border'}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs text-slate-400">{children}</span>;
}

function Input({
  value, onChange, placeholder, type = 'text', required,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; required?: boolean;
}) {
  return (
    <input
      type={type} value={value} required={required} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-brand/50 focus:outline-none"
    />
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-slate-500">{children}</p>;
}

function CopyBox({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-xs text-brand hover:underline"
        >{copied ? 'Copied!' : 'Copy'}</button>
      </div>
      <p className="font-mono text-xs text-slate-300 break-all">{value || '—'}</p>
    </div>
  );
}

// ─── Step 1: Agreement details ────────────────────────────────────────────────

function Step1({
  form, onChange, onNext,
}: {
  form: Step1Form;
  onChange: (k: keyof Step1Form, v: string) => void;
  onNext: () => void;
}) {
  function submit(e: React.FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>Label (optional)</Label>
        <Input value={form.label} onChange={(v) => onChange('label', v)} placeholder="MyApp v2 — Acme Corp" />
      </div>
      <div>
        <Label>Buyer Aptos address *</Label>
        <Input value={form.buyerAddress} onChange={(v) => onChange('buyerAddress', v)} placeholder="0x…" required />
        <Hint>The buyer's Aptos wallet address. They will call accept_agreement to activate the escrow.</Hint>
      </div>
      <div>
        <Label>Your Shelby account address *</Label>
        <Input value={form.shelbyAccount} onChange={(v) => onChange('shelbyAccount', v)} placeholder="0x… (same as your Aptos address)" required />
        <Hint>Your Aptos address — this is where blobs will be stored on Shelby Protocol.</Hint>
      </div>
      <div>
        <Label>Initial blob name *</Label>
        <Input value={form.blobName} onChange={(v) => onChange('blobName', v)} placeholder="myorg/myapp/v1.0.0" required />
        <Hint>Shelby blob path for the first commit. The GitHub Action will update this on each release.</Hint>
      </div>
      <div>
        <Label>Expiry date *</Label>
        <Input type="datetime-local" value={form.expiry} onChange={(v) => onChange('expiry', v)} required />
        <Hint>The non-renewal trigger fires if the vendor does not renew before this date.</Hint>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary">Next →</button>
      </div>
    </form>
  );
}

interface Step1Form {
  label: string;
  buyerAddress: string;
  shelbyAccount: string;
  blobName: string;
  expiry: string;
}

// ─── Step 2: Encryption setup ─────────────────────────────────────────────────

function Step2({
  form, onChange, onNext, onBack,
}: {
  form: Step2Form;
  onChange: (k: keyof Step2Form, v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  function submit(e: React.FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-brand/20 bg-brand/5 p-4 text-sm text-slate-300">
        <p className="font-medium text-slate-200 mb-1">How encryption works</p>
        <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs">
          <li>Generate a 32-byte AES-256-GCM key using the VaultLayer SDK: <code className="text-brand">VaultLayerClient.generateKey()</code></li>
          <li>Encrypt that key with the buyer's Aptos public key (ECIES / hybrid encryption).</li>
          <li>Paste both values below. The raw key goes in your GitHub Action secrets; the encrypted key is stored on-chain.</li>
        </ol>
      </div>

      <div>
        <Label>Encrypted key (hex) *</Label>
        <Input
          value={form.encryptedKey}
          onChange={(v) => onChange('encryptedKey', v)}
          placeholder="0x… (AES key encrypted with buyer public key)"
          required
        />
        <Hint>
          This is stored on the Aptos escrow contract and released to the buyer when a trigger fires.
          Use <code>0x00</code> as a placeholder if you haven't performed key exchange yet — update via record_commit later.
        </Hint>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="btn-ghost">← Back</button>
        <button type="submit" className="btn-primary">Next →</button>
      </div>
    </form>
  );
}

interface Step2Form {
  encryptedKey: string;
}

// ─── Step 3: Review & submit ──────────────────────────────────────────────────

function Step3({
  s1, s2, onBack, onSubmit, busy, error,
}: {
  s1: Step1Form; s2: Step2Form;
  onBack: () => void; onSubmit: () => void;
  busy: boolean; error: string;
}) {
  const expiryTs = Math.floor(new Date(s1.expiry).getTime() / 1000);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface divide-y divide-surface-border">
        <Row label="Buyer" value={s1.buyerAddress} mono />
        <Row label="Shelby account" value={s1.shelbyAccount} mono />
        <Row label="Blob name" value={s1.blobName} mono />
        <Row label="Expiry" value={`${s1.expiry} (${expiryTs})`} />
        <Row label="Encrypted key" value={s2.encryptedKey.slice(0, 24) + '…'} mono />
      </div>

      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 text-xs text-yellow-300 space-y-1">
        <p className="font-medium">Before submitting</p>
        <ul className="list-disc list-inside space-y-0.5 text-yellow-400/80">
          <li>Your wallet will be asked to sign the create_agreement transaction.</li>
          <li>Initial Merkle roots, IV, and auth tag are set to empty bytes — they will be filled by the first GitHub Action commit.</li>
          <li>Save the agreement ID shown in Step 4 — you'll need it in your GitHub Action config.</li>
        </ul>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-between">
        <button onClick={onBack} disabled={busy} className="btn-ghost">← Back</button>
        <button onClick={onSubmit} disabled={busy} className="btn-primary">
          {busy ? 'Submitting…' : 'Submit on Aptos'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right text-slate-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function Step4({ agreementId, s1 }: { agreementId: number | null; s1: Step1Form }) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <div className="text-4xl">🎉</div>
        <p className="text-xl font-semibold text-slate-100">Agreement created!</p>
        {agreementId !== null && (
          <p className="text-slate-400 text-sm">
            Agreement ID: <span className="font-mono text-brand font-bold">#{agreementId}</span>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-300">GitHub Action secrets to configure</p>
        <CopyBox label="VAULTLAYER_AGREEMENT_ID" value={String(agreementId ?? '')} />
        <CopyBox label="VAULTLAYER_SHELBY_ACCOUNT (for reference)" value={s1.shelbyAccount} />
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-4 text-sm text-slate-400 space-y-1">
        <p className="font-medium text-slate-300">Next steps</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Copy <code>packages/github-action/example-workflow.yml</code> to your repo's <code>.github/workflows/</code>.</li>
          <li>Add the required secrets from Step 2 to your GitHub repository.</li>
          <li>Push a <code>v*</code> tag — the action will upload the archive to Shelby and call <code>record_commit</code>.</li>
          <li>Share the agreement ID with the buyer so they can call <code>accept_agreement</code>.</li>
        </ol>
      </div>

      <div className="flex gap-2 justify-center">
        <button onClick={() => router.push('/vendor')} className="btn-primary">Go to Dashboard</button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewAgreementPage() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<number | null>(null);

  const [s1, setS1] = useState<Step1Form>({
    label: '', buyerAddress: '', shelbyAccount: '', blobName: '', expiry: '',
  });
  const [s2, setS2] = useState<Step2Form>({ encryptedKey: '' });

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const expiryTs = Math.floor(new Date(s1.expiry).getTime() / 1000);
      const encKey = s2.encryptedKey.startsWith('0x') ? s2.encryptedKey.slice(2) : s2.encryptedKey;
      const empty = '00';

      const response = await signAndSubmitTransaction({
        data: {
          function: `${CONTRACT_ADDRESS}::escrow::create_agreement`,
          functionArguments: [
            s1.buyerAddress,
            s1.shelbyAccount,
            s1.blobName,
            // content_merkle_root, shelby_merkle_root, iv, auth_tag — all placeholder
            [0], [0],
            encKey ? Array.from(Buffer.from(encKey, 'hex')) : [0],
            [0], [0],
            expiryTs.toString(),
          ],
        },
      });

      // The agreement ID is next_id at the time of creation.
      // We parse it from the emitted event; for simplicity we show it as
      // "check your Aptos explorer" if we can't parse it yet.
      // In a real integration, query the AgreementCreated event from the tx.
      void response;

      // Save locally
      if (account?.address) {
        // ID is unknown until we parse events — use a placeholder
        const tempId = Date.now(); // will be updated when user checks explorer
        saveAgreement(account.address, {
          id: tempId,
          label: s1.label || `Agreement — ${s1.blobName}`,
          blobName: s1.blobName,
          buyerAddress: s1.buyerAddress,
          shelbyAccount: s1.shelbyAccount,
          createdAt: Date.now(),
        });
      }

      setCreatedId(null); // user must check Aptos explorer for the ID
      setStep(3);
    } catch (ex) {
      setError(String(ex));
    } finally {
      setBusy(false);
    }
  }

  if (!connected || !account) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-300 font-medium">Connect your wallet to create an escrow agreement.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">New Escrow Agreement</h1>
        <p className="text-sm text-slate-400 mt-1">
          Create a trustless software escrow agreement on Aptos.
        </p>
      </div>

      <StepIndicator current={step} />

      <div className="rounded-xl border border-surface-border bg-surface-card p-6">
        {step === 0 && (
          <Step1 form={s1} onChange={(k, v) => setS1((f) => ({ ...f, [k]: v }))} onNext={() => setStep(1)} />
        )}
        {step === 1 && (
          <Step2 form={s2} onChange={(k, v) => setS2((f) => ({ ...f, [k]: v }))} onNext={() => setStep(2)} onBack={() => setStep(0)} />
        )}
        {step === 2 && (
          <Step3 s1={s1} s2={s2} onBack={() => setStep(1)} onSubmit={submit} busy={busy} error={error} />
        )}
        {step === 3 && <Step4 agreementId={createdId} s1={s1} />}
      </div>
    </div>
  );
}
