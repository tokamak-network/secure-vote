import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function CoordinatorGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // Simple cookie check
    const hasAuth = document.cookie.split('; ').some(row => row.startsWith('coordinator_auth=true'));

    if (!hasAuth) {
      // Allow specific bypass for login page (though this component shouldn't be used there)
      if (router.pathname !== '/coordinator/login') {
        router.push('/coordinator/login');
      }
    } else {
      setAuthed(true);
    }
  }, [router]);

  if (!authed) {
    return (
      <div className="flex h-screen items-center justify-center bg-carbon-bg text-carbon-text-secondary">
        <div className="animate-pulse">Verifying access...</div>
      </div>
    );
  }

  return <>{children}</>;
}
