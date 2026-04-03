'use client';

import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { APTOS_NETWORK } from '@/lib/constants';

const NETWORK_MAP: Record<string, Network> = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
  devnet: Network.DEVNET,
};

const network = NETWORK_MAP[APTOS_NETWORK] ?? Network.MAINNET;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={false}
      dappConfig={{ network }}
      onError={(err) => console.error('[WalletAdapter]', err)}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
