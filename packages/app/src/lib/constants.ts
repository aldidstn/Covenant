export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '';

export const APTOS_NODE_URL =
  process.env.NEXT_PUBLIC_APTOS_NODE_URL ??
  'https://fullnode.mainnet.aptoslabs.com/v1';

export const APTOS_NETWORK =
  (process.env.NEXT_PUBLIC_APTOS_NETWORK as 'mainnet' | 'testnet' | 'devnet') ??
  'mainnet';

export const GRACE_PERIOD_SECONDS = 172_800; // 48 h

export const STATE_LABEL: Record<number, string> = {
  0: 'Pending',
  1: 'Active',
  2: 'Triggered',
};

export const STATE_CLASS: Record<number, string> = {
  0: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  1: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  2: 'text-red-400 bg-red-400/10 border-red-400/20',
};
