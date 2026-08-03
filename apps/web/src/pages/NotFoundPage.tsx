import { EmptyState } from '@deal-finder/ui';
import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-8" aria-hidden="true" />}
      title="Page not found"
      description="That page does not exist. It may have moved, or the link may be incomplete."
      action={
        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-lg bg-accent-700 px-4 text-sm font-semibold text-white hover:bg-accent-800"
        >
          Back to home
        </Link>
      }
    />
  );
}
