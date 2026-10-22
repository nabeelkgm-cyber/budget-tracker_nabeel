/** Asks the browser not to clear this app's data when the phone is low on space. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {}
  return false;
}
