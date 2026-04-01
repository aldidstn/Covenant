import type { Metadata } from 'next';
import './globals.css';
import { WalletProvider } from '@/components/WalletProvider';
import { NavBar } from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'VaultLayer',
  description: 'Trustless software escrow on Shelby Protocol + Aptos',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <WalletProvider>
          <NavBar />
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
