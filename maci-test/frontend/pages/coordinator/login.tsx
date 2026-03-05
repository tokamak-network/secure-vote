import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Layout from '@/components/Layout';

export default function CoordinatorLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.success) {
        router.push('/coordinator');
      } else {
        setError('Invalid password');
      }
    } catch (err) {
      setError('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <Head>
        <title>Coordinator Login | SecureVote</title>
      </Head>

      <div className="max-w-md mx-auto mt-20">
        <div className="bg-surface-dark border border-border-dark p-8">
          <h1 className="text-2xl font-light text-white tracking-tight mb-2">Coordinator Access</h1>
          <p className="text-zinc-500 text-sm mb-8">
            Enter the password to access the coordinator dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 block mb-2">
                Password
              </label>
              <input
                type="password"
                className="w-full px-4 py-3 bg-background-dark border border-border-dark text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-accent-blue transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                autoFocus
              />
            </div>

            {error && (
              <div className="p-4 bg-rose-950/20 border border-rose-500/20 text-rose-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-accent-blue text-white px-5 py-3 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Verifying...' : 'Access Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
