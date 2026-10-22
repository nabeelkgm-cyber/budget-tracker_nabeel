export interface FileKind {
  mimeType: string;
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

/** Web: offers the iPhone share sheet (Save to Files) when available, otherwise downloads the file. */
export async function shareFile(name: string, content: string | Uint8Array, kind: FileKind): Promise<void> {
  const blob = new Blob([content as BlobPart], { type: kind.mimeType });
  const file = new File([blob], name, { type: kind.mimeType });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pick(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const f = await pick();
  return f ? { name: f.name, text: await f.text() } : null;
}

export async function pickFileBytes(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const f = await pick();
  return f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
}
