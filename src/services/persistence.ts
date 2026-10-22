/** Native apps keep their data safely already. */
export async function requestPersistentStorage(): Promise<boolean> {
  return true;
}
