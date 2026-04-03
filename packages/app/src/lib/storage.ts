'use client';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Off-chain metadata the vendor saves locally when creating an agreement. */
export interface AgreementMeta {
  id: number;
  blobName: string;
  buyerAddress: string;
  shelbyAccount: string;
  label?: string;          // human-friendly name, e.g. "MyApp v2 — Acme Corp"
  createdAt: number;       // Unix ms
}

// ─── Storage key ─────────────────────────────────────────────────────────────

function key(walletAddress: string) {
  return `covenant:agreements:${walletAddress.toLowerCase()}`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function getAgreements(walletAddress: string): AgreementMeta[] {
  try {
    const raw = localStorage.getItem(key(walletAddress));
    return raw ? (JSON.parse(raw) as AgreementMeta[]) : [];
  } catch {
    return [];
  }
}

export function saveAgreement(
  walletAddress: string,
  agreement: AgreementMeta,
): void {
  const list = getAgreements(walletAddress);
  const idx = list.findIndex((a) => a.id === agreement.id);
  if (idx >= 0) {
    list[idx] = agreement;
  } else {
    list.unshift(agreement); // newest first
  }
  localStorage.setItem(key(walletAddress), JSON.stringify(list));
}

export function removeAgreement(walletAddress: string, id: number): void {
  const list = getAgreements(walletAddress).filter((a) => a.id !== id);
  localStorage.setItem(key(walletAddress), JSON.stringify(list));
}
