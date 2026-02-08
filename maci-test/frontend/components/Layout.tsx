import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useState } from 'react';
import { useAccount } from 'wagmi';

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { address } = useAccount();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const isCoordinator = router.pathname.startsWith('/coordinator');

  const handleFaucet = async () => {
    if (!address) return;
    setFaucetLoading(true);
    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.funded) alert('Sent 1 ETH to your wallet!');
        else alert('Balance sufficient (already > 0.5 ETH)');
      } else {
        alert('Faucet failed: ' + data.error);
      }
    } catch (err) {
      alert('Faucet failed');
    } finally {
      setFaucetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-carbon-bg">
      <header className="h-12 border-b border-carbon-border-subtle bg-carbon-layer-1">
        <div className="max-w-[960px] mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-sm font-semibold text-carbon-text-primary tracking-tight">
              secure-vote
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/"
                className={`px-3 py-1.5 text-sm transition-colors ${
                  !isCoordinator
                    ? 'text-white bg-carbon-layer-2'
                    : 'text-carbon-text-helper hover:text-carbon-text-secondary hover:bg-carbon-layer-hover'
                }`}
              >
                Elections
              </Link>
              <Link
                href="/coordinator"
                className={`px-3 py-1.5 text-sm transition-colors ${
                  isCoordinator
                    ? 'text-white bg-carbon-layer-2'
                    : 'text-carbon-text-helper hover:text-carbon-text-secondary hover:bg-carbon-layer-hover'
                }`}
              >
                Coordinator
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {address && (
              <button
                onClick={handleFaucet}
                disabled={faucetLoading}
                className="text-xs text-carbon-interactive hover:text-carbon-interactive-hover disabled:opacity-50"
              >
                {faucetLoading ? 'Sending...' : 'Get Test ETH'}
              </button>
            )}
            <ConnectButton showBalance={false} />
          </div>
        </div>
      </header>
      <main className="max-w-[960px] mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
