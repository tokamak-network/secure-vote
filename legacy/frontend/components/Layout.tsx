import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#121215]">
      {/* Header */}
      <header className="border-b border-white/[0.06]">
        <div className="max-w-[1012px] mx-auto px-5 h-[72px] flex items-center justify-between">
          <Link href="/" className="text-[21px] font-semibold text-white">
            secure vote
          </Link>
          <ConnectButton showBalance={false} />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1012px] mx-auto px-5 py-6">
        {children}
      </main>
    </div>
  );
}
