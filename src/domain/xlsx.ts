import { strToU8, zipSync } from 'fflate';

/**
 * A minimal, dependency-light .xlsx writer: text, numbers, dates and 2/3-decimal amounts,
 * bold frozen header row with filter, column widths. Opens in Excel, Numbers and Google Sheets.
 */
export type ColumnKind = 'text' | 'number' | 'date' | 'amount2' | 'amount3';

export interface SheetColumn {
  header: string;
  kind?: ColumnKind;
  width?: number;
}

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  /** Dates are 'YYYY-MM-DD' strings; amounts are numbers in major units. */
  rows: (string | number | null)[][];
}

const STYLE: Record<ColumnKind, number> = { text: 0, number: 0, date: 2, amount2: 3, amount3: 4 };

export const columnLetter = (index: number): string => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

/** Escapes text for XML and drops characters XML cannot contain. */
export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Excel date serial (days since 1899-12-30) for 'YYYY-MM-DD'. */
export function excelDateSerial(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round(ms / 86_400_000) + 25569;
}

export const safeSheetName = (name: string): string =>
  (name.replace(/[\[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);

function sheetXml(sheet: Sheet): string {
  const cols = sheet.columns;
  const widths = cols
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join('');
  const header = cols
    .map((c, i) => `<c r="${columnLetter(i)}1" s="1" t="inlineStr"><is><t>${xmlEscape(c.header)}</t></is></c>`)
    .join('');
  const body = sheet.rows
    .map((row, r) => {
      const cells = cols
        .map((col, c) => {
          const v = row[c];
          const ref = `${columnLetter(c)}${r + 2}`;
          if (v === null || v === undefined || v === '') return '';
          const kind = col.kind ?? 'text';
          if (kind === 'date' && typeof v === 'string') {
            const serial = excelDateSerial(v);
            if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
          }
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}" s="${STYLE[kind]}"><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join('');
  const last = `${columnLetter(Math.max(0, cols.length - 1))}${sheet.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="#,##0.000"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>';

/** Builds the file bytes. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const named = sheets.map((s) => {
    let name = safeSheetName(s.name);
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${safeSheetName(s.name).slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return { ...s, name };
  });

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        named.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  named.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}
