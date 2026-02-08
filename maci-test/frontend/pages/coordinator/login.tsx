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
        <div className="carbon-card p-8">
          <h1 className="text-2xl font-light mb-2">Coordinator Access</h1>
          <p className="text-carbon-text-secondary text-sm mb-8">
            Please enter the password to access the coordinator dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-xs uppercase tracking-wider text-carbon-text-secondary block mb-2">
                Password
              </label>
              <input
                type="password"
                className="carbon-input w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 bg-carbon-support-error/10 border border-carbon-support-error text-carbon-support-error text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="carbon-btn-primary w-full justify-center"
            >
              {loading ? 'Verifying...' : 'Access Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
