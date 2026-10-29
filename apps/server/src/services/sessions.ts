import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { sessionBindings, sessions } from '../db/schema';
import { syncActiveSessions } from './keys';

/** Deletes a session and its key bindings, releasing the bound keys. Returns false when it did not exist. */
export function deleteSessionRecords(db: DbExecutor, sessionId: string): boolean {
  return db.transaction((tx) => {
    const bound = tx
      .select({ apiKeyId: sessionBindings.apiKeyId })
      .from(sessionBindings)
      .where(eq(sessionBindings.sessionId, sessionId))
      .all();
    const deleted = tx.delete(sessions).where(eq(sessions.id, sessionId)).run().changes > 0;
    syncActiveSessions(
      tx,
      bound.map((binding) => binding.apiKeyId),
    );
    return deleted;
  });
}
