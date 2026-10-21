import * as Crypto from 'expo-crypto';

/** SHA-256 of some text, as hex. Used to recognise a file or pasted text that was already imported. */
export const sha256 = (text: string): Promise<string> => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
