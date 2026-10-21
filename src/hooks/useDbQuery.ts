import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToChanges } from '@/db/events';
import type { Db } from '@/db/types';

/** Runs `query` now, whenever the screen gains focus, and after any DB write. */
export function useDbQuery<T>(query: (db: Db) => Promise<T>, deps: unknown[] = []) {
  const db = useSQLiteContext();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    queryRef.current(db).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(e instanceof Error ? e : new Error(String(e))),
    );
  }, [db, ...deps]);

  useEffect(() => subscribeToChanges(load), [load]);
  useFocusEffect(load);
  return { data, error, reload: load };
}
