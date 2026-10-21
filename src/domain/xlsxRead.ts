import { strFromU8, unzipSync } from 'fflate';

/** Reads the cells of an .xlsx file as text. Dates become 'YYYY-MM-DD'. (Old .xls files are not supported.) */
export interface XlsxSheet {
  name: string;
  rows: string[][];
}

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const textOf = (xml: string): string => {
  const parts = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]));
  return parts.join('');
};

const colIndex = (ref: string): number => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Excel day number -> 'YYYY-MM-DD'. */
export function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

const isDateFormat = (code: string): boolean => {
  const c = code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, '');
  return /[dmyhs]/i.test(c) && !/^[#0,.\s%]*$/.test(c);
};

export function readXlsx(bytes: Uint8Array): XlsxSheet[] {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error('This is not a valid .xlsx file. Old .xls files must be saved as .xlsx or CSV first.');
  }
  const get = (name: string): string | null => (zip[name] ? strFromU8(zip[name]) : null);
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new Error('This is not a valid .xlsx file.');

  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  // Which cell styles are dates?
  const styles = get('xl/styles.xml') ?? '';
  const customDate = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    if (isDateFormat(decode(m[2]))) customDate.add(Number(m[1]));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...cellXfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].map(
    (m) => BUILTIN_DATE_FORMATS.has(Number(m[1])) || customDate.has(Number(m[1])),
  );

  // sheet name -> file
  const rels = new Map<string, string>();
  for (const m of (get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = rid && rels.get(rid) ? get(rels.get(rid)!) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row: string[] = [];
      const rowNumber = Number(/\br="(\d+)"/.exec(rm[0])?.[1] ?? rows.length + 1);
      for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const body = cm[2] ?? '';
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : row.length;
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str' || type === 'e') value = v !== undefined ? decode(v) : '';
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) {
          const n = Number(v);
          value = dateStyle[style] && Number.isFinite(n) && n > 0 ? serialToIso(n) : decode(v);
        }
        while (row.length < idx) row.push('');
        row[idx] = value;
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = row;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
