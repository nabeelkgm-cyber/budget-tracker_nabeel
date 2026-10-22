/** Web version: the browser's localStorage (there is no Keychain in a browser). */
export const secureGet = async (key: string): Promise<string | null> => window.localStorage.getItem(`bt.${key}`);
export const secureSet = async (key: string, value: string): Promise<void> => window.localStorage.setItem(`bt.${key}`, value);
export const secureDelete = async (key: string): Promise<void> => window.localStorage.removeItem(`bt.${key}`);
