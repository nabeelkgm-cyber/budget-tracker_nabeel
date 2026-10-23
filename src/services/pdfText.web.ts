import type { PdfTextItem } from '@/domain/pdfTable';

/** The small part of pdf.js (loaded from /pdfjs when first needed) that is used here. */
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: { str?: string; transform: number[]; width: number }[] }>;
      }>;
      destroy(): Promise<void>;
    }>;
    onPassword?: (update: (password: string) => void, reason: number) => void;
    destroy(): Promise<void>;
  };
}

declare global {
  interface Window {
    pdfjsLib?: PdfJs;
  }
}

function loadPdfJs(): Promise<PdfJs> {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/pdfjs/pdf.min.js';
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('Could not start the PDF reader.'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Could not load the PDF reader. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
}

/**
 * Reads every piece of text on every page of a PDF, with its position. The file never leaves this device.
 * Bank statements are often password protected; the password is asked for here.
 */
export async function readPdfText(bytes: Uint8Array): Promise<PdfTextItem[][]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let cancelled = false;
  task.onPassword = (update, reason) => {
    const pw = window.prompt(reason === 2 ? 'That password is not right. Try again:' : 'This PDF is password protected. Enter its password:');
    if (pw === null) {
      cancelled = true;
      task.destroy();
    } else update(pw);
  };
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (cancelled) throw new Error('A password is needed to read this PDF.');
    throw new Error(`Could not open the PDF (${e instanceof Error ? e.message : String(e)}).`);
  }
  try {
    const pages: PdfTextItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items
          .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
          .map((i) => ({ str: i.str as string, x: i.transform[4], y: i.transform[5], width: i.width })),
      );
    }
    return pages;
  } finally {
    doc.destroy();
  }
}
