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
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-sv-border-subtle bg-sv-bg/80 backdrop-blur-xl">
        <div className="max-w-[1024px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <svg className="w-5 h-5 text-sv-accent group-hover:text-sv-accent-hover transition-colors" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.4 9.36-7 10.5-3.6-1.14-7-5.67-7-10.5V6.3l7-3.12z"/>
                <path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z"/>
              </svg>
              <span className="text-sm font-bold text-sv-text-primary tracking-tight">
                SecureVote
              </span>
            </Link>
            <nav className="flex items-center">
              <Link
                href="/"
                className={`relative px-4 py-4 text-sm transition-colors ${
                  !isCoordinator
                    ? 'text-sv-text-primary font-medium'
                    : 'text-sv-text-muted hover:text-sv-text-secondary'
                }`}
              >
                Elections
                {!isCoordinator && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-sv-accent rounded-full" />
                )}
              </Link>
              <Link
                href="/coordinator"
                className={`relative px-4 py-4 text-sm transition-colors ${
                  isCoordinator
                    ? 'text-sv-text-primary font-medium'
                    : 'text-sv-text-muted hover:text-sv-text-secondary'
                }`}
              >
                Coordinator
                {isCoordinator && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-sv-accent rounded-full" />
                )}
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {address && (
              <button
                onClick={handleFaucet}
                disabled={faucetLoading}
                className="text-xs text-sv-accent hover:text-sv-accent-hover disabled:opacity-50 transition-colors"
              >
                {faucetLoading ? 'Sending...' : 'Get Test ETH'}
              </button>
            )}
            <ConnectButton showBalance={false} />
          </div>
        </div>
      </header>
      <main className="max-w-[1024px] mx-auto px-6 py-10">
        {children}
      </main>
      <footer className="border-t border-sv-border-subtle mt-20">
        <div className="max-w-[1024px] mx-auto px-6 py-6 flex items-center justify-between text-2xs text-sv-text-disabled">
          <span>MACI + Risk-Limiting Audit Protocol</span>
          <span>ZKP-verified secure voting</span>
        </div>
      </footer>
    </div>
  );
}
