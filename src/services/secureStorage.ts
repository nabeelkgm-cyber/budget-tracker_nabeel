import * as SecureStore from 'expo-secure-store';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Small private settings (the app-lock PIN data) kept in the iPhone Keychain. */
export const secureGet = (key: string) => SecureStore.getItemAsync(key, OPTIONS);
export const secureSet = (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS);
export const secureDelete = (key: string) => SecureStore.deleteItemAsync(key, OPTIONS);
