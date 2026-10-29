import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Shows API validation issues (and slug conflicts) next to the matching form fields. */
export function applyApiIssues<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): void {
  if (!(error instanceof ApiError)) return;
  for (const issue of error.issues) {
    if (fields.includes(issue.path.split('.')[0] ?? '')) {
      setError(issue.path as Path<T>, { type: 'server', message: issue.message });
    }
  }
  if (error.status === 409 && fields.includes('slug') && /slug/i.test(error.message)) {
    setError('slug' as Path<T>, { type: 'server', message: error.message });
  }
}
