/** Tiny pub/sub so screens re-query after any write. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyChange(): void {
  listeners.forEach((fn) => fn());
}
