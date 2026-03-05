import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { address } = useAccount();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isCoordinator = router.pathname.startsWith('/coordinator');

  useEffect(() => {
    setMounted(true);
  }, []);

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
    <div className="min-h-screen flex flex-col items-center">
      <nav className="w-full max-w-7xl px-8 h-20 flex items-center justify-between border-b border-border-dark bg-background-dark">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-semibold tracking-tight text-white">
            SecureVote
          </Link>
          {mounted && (
            <div className="flex items-center gap-6 text-sm">
              <Link
                href="/"
                className={`transition-colors ${router.pathname === '/' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Elections
              </Link>
              <Link
                href="/coordinator"
                className={`transition-colors ${router.pathname.startsWith('/coordinator') ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Coordinator
              </Link>
            </div>
          )}
        </div>
        <div className="flex items-center gap-6">
          {mounted && address && (
            <button
              onClick={handleFaucet}
              disabled={faucetLoading}
              className="text-sm text-accent-blue hover:text-blue-400 disabled:opacity-50 transition-colors"
            >
              {faucetLoading ? 'Sending...' : 'Get Test ETH'}
            </button>
          )}
          <div className="text-sm font-mono text-zinc-500">
            {mounted && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
          </div>
          {mounted && <ConnectButton showBalance={false} />}
        </div>
      </nav>
      <main className="w-full max-w-7xl px-8 py-12 flex-grow">
        {children}
      </main>
    </div>
  );
}
