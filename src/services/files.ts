import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface FileKind {
  mimeType: string;
  /** iOS uniform type identifier, shown in the share sheet. */
  uti: string;
}

export const FILE_KINDS = {
  csv: { mimeType: 'text/csv', uti: 'public.comma-separated-values-text' },
  json: { mimeType: 'application/json', uti: 'public.json' },
  xlsx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
  },
} satisfies Record<string, FileKind>;

/** Writes a file to the cache and opens the iOS share sheet (Save to Files, AirDrop, Mail...). */
export async function shareFile(name: string, content: string | Uint8Array, kind: FileKind): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: kind.mimeType, UTI: kind.uti, dialogTitle: name });
}

/** Lets the user choose a file and returns its text, or null if they cancelled. */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const text = await new File(asset.uri).text();
  return { name: asset.name, text };
}
