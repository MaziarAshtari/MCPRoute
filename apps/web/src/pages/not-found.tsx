import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you are looking for does not exist or was moved."
      action={
        <Button asChild>
          <Link to="/">Back to the dashboard</Link>
        </Button>
      }
    />
  );
}
