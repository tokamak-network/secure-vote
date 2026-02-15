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
        <h1 className="text-heading font-bold text-sv-text-primary mb-1">Create Election</h1>
        <p className="text-sm text-sv-text-muted mb-8">Deploy a new MACI poll for encrypted voting.</p>

        {error && (
          <div className="mb-6 px-5 py-4 bg-sv-error/10 text-sv-error-light text-sm border border-sv-error/20 rounded-lg flex items-start gap-3">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="sv-section-label block mb-2">
              Election Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 2024 Student Council Election"
              className="sv-input"
            />
          </div>

          <div>
            <label className="sv-section-label block mb-2">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Humanities / Philosophy"
              className="sv-input"
            />
          </div>

          <div>
            <label className="sv-section-label block mb-2">
              Voting Duration (seconds)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="sv-input"
            />
            <p className="text-xs text-sv-text-disabled mt-2">
              Default: 3600 (1 hour). Use shorter durations for testing.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="sv-btn-primary w-full"
          >
            {loading ? 'Creating...' : 'Create Election'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
