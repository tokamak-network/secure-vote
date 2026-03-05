import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';

export default function CreateElection() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [duration, setDuration] = useState('3600');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/elections/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim(),
          duration: parseInt(duration, 10),
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to create election');

      router.push(`/elections/${data.pollId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create election');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-md mx-auto">
        <h1 className="text-4xl font-light text-white tracking-tight mb-2">Create Election</h1>
        <p className="text-base text-zinc-500 mb-8">Deploy a new MACI poll for encrypted voting.</p>

        {error && (
          <div className="mb-6 px-5 py-4 bg-rose-950/20 text-rose-400 text-sm border border-rose-500/20 flex items-start gap-3">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 block mb-2">
              Election Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Governance Proposal #42"
              className="w-full px-4 py-3 bg-surface-dark border border-border-dark text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-accent-blue transition-all"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 block mb-2">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Protocol Upgrade"
              className="w-full px-4 py-3 bg-surface-dark border border-border-dark text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-accent-blue transition-all"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 block mb-2">
              Voting Duration (seconds)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full px-4 py-3 bg-surface-dark border border-border-dark text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-accent-blue transition-all"
            />
            <p className="text-xs text-zinc-600 mt-2">
              Default: 3600 (1 hour). Use shorter durations for testing.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-accent-blue text-white px-5 py-3 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create Election'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
