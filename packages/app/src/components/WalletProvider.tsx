'use client';

import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { APTOS_NETWORK } from '@/lib/constants';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={false}
      dappConfig={{ network: APTOS_NETWORK }}
      onError={(err) => console.error('[WalletAdapter]', err)}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
