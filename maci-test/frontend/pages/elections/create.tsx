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
        <h1 className="text-heading font-semibold text-carbon-text-primary mb-1">Create Election</h1>
        <p className="text-sm text-carbon-text-helper mb-8">Deploy a new MACI poll for encrypted voting.</p>

        {error && (
          <div className="mb-6 px-4 py-3 bg-carbon-support-error/10 text-carbon-support-error-light text-sm border-l-2 border-carbon-support-error">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="block text-xs text-carbon-text-helper uppercase tracking-wider mb-2">
              Election Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 2024 Student Council Election"
              className="carbon-input"
            />
          </div>

          <div>
            <label className="block text-xs text-carbon-text-helper uppercase tracking-wider mb-2">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Humanities / Philosophy"
              className="carbon-input"
            />
          </div>

          <div>
            <label className="block text-xs text-carbon-text-helper uppercase tracking-wider mb-2">
              Voting Duration (seconds)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="carbon-input"
            />
            <p className="text-xs text-carbon-text-disabled mt-2">
              Default: 3600 (1 hour). Use shorter durations for testing.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="carbon-btn-primary w-full"
          >
            {loading ? 'Creating...' : 'Create Election'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
