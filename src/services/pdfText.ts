import type { PdfTextItem } from '@/domain/pdfTable';

/** Phone app: reading PDFs needs the browser's PDF engine, which only the web app has. */
export async function readPdfText(_bytes: Uint8Array): Promise<PdfTextItem[][]> {
  throw new Error('PDF statements can be imported in the web app. In this app, use a CSV or Excel statement.');
}
