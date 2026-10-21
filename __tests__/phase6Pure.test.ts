import { strFromU8, unzipSync } from 'fflate';
import { createHash, randomBytes } from 'crypto';
import { detectDelimiter, parseCsv, protectCell, toCsv, unprotectCell } from '@/domain/csv';
import { buildXlsx, columnLetter, excelDateSerial, safeSheetName, xmlEscape } from '@/domain/xlsx';
import {
  createStoredPin,
  isValidPin,
  isWeakPin,
  lockoutSeconds,
  shouldLockAfterAbsence,
  verifyPin,
} from '@/domain/pin';

describe('csv', () => {
  it('writes quotes, commas, quotes-in-quotes and line breaks safely, and reads them back', () => {
    const rows = [
      ['Date', 'Note', 'Amount'],
      ['2026-10-01', 'Lulu, "Hyper" market', 125.5],
      ['2026-10-02', 'two\nlines', null],
      ['2026-10-03', '', 0],
    ];
    const text = toCsv(rows);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(parseCsv(text)).toEqual([
      ['Date', 'Note', 'Amount'],
      ['2026-10-01', 'Lulu, "Hyper" market', '125.5'],
      ['2026-10-02', 'two\nlines', ''],
      ['2026-10-03', '', '0'],
    ]);
  });

  it('reads Windows, Unix and old Mac line endings, a BOM, and skips blank lines', () => {
    for (const nl of ['\r\n', '\n', '\r']) {
      expect(parseCsv(`﻿a,b${nl}1,2${nl}${nl}3,4${nl}`)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    }
  });

  it('handles a last line without a line ending, and an empty last field', () => {
    expect(parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('detects semicolon and tab separated files', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a;b",c')).toBe(',');
    expect(parseCsv('Date;Amount\n2026-10-01;12,50')).toEqual([['Date', 'Amount'], ['2026-10-01', '12,50']]);
  });

  it('protects text that a spreadsheet could run as a formula, and undoes it on import', () => {
    expect(protectCell('=1+1')).toBe("'=1+1");
    expect(protectCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(protectCell('-cmd')).toBe("'-cmd");
    expect(protectCell('-12.50')).toBe('-12.50'); // a plain number stays
    expect(protectCell('Lulu')).toBe('Lulu');
    expect(unprotectCell("'=1+1")).toBe('=1+1');
    expect(unprotectCell("'hello")).toBe("'hello");
    const back = parseCsv(toCsv([['=HYPERLINK("x")']]))[0][0];
    expect(unprotectCell(back)).toBe('=HYPERLINK("x")');
  });
});

describe('xlsx', () => {
  const wellFormed = (xml: string) => {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:_]+)([^>]*?)(\/?)>/g)) {
      if (m[2].startsWith('?')) continue;
      if (m[4] === '/') continue;
      if (m[1] === '/') expect(stack.pop()).toBe(m[2]);
      else stack.push(m[2]);
    }
    expect(stack).toEqual([]);
  };

  const bytes = buildXlsx([
    {
      name: 'Transactions',
      columns: [
        { header: 'Date', kind: 'date' },
        { header: 'Note' },
        { header: 'Amount', kind: 'amount2' },
        { header: 'OMR', kind: 'amount3' },
      ],
      rows: [
        ['2026-10-21', 'Tom & "Jerry" <3', 1234.5, 1.25],
        [null, 'ctrl\u0001char', 0, null],
      ],
    },
    { name: 'Bad/name:[x]', columns: [{ header: 'A' }], rows: [] },
  ]);
  const zip = unzipSync(bytes);

  it('is a zip with the required parts', () => {
    expect(Object.keys(zip).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
  });

  it('every part is well-formed XML', () => {
    for (const [name, data] of Object.entries(zip)) {
      const xml = strFromU8(data);
      expect(xml.startsWith('<?xml')).toBe(true);
      wellFormed(xml);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('writes numbers as numbers, dates as serials, and escapes text', () => {
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="A2" s="2"><v>46316</v></c>'); // 2026-10-21
    expect(sheet).toContain('<c r="C2" s="3"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="D2" s="4"><v>1.25</v></c>');
    expect(sheet).toContain('Tom &amp; &quot;Jerry&quot; &lt;3');
    expect(sheet).not.toContain('\u0001');
    expect(sheet).toContain('<autoFilter ref="A1:D3"/>');
  });

  it('cleans sheet names and keeps them unique', () => {
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Bad name  x"');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
    const two = unzipSync(buildXlsx([{ name: 'A', columns: [], rows: [] }, { name: 'a', columns: [], rows: [] }]));
    expect(strFromU8(two['xl/workbook.xml'])).toContain('name="A"');
    expect(strFromU8(two['xl/workbook.xml'])).toContain('name="a 2"');
  });

  it('helpers', () => {
    expect(excelDateSerial('1900-03-01')).toBe(61);
    expect(excelDateSerial('2026-10-21')).toBe(46316);
    expect(excelDateSerial('nope')).toBeNull();
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    expect(xmlEscape("a<b>&'")).toBe("a&lt;b&gt;&amp;'");
  });
});

describe('pin', () => {
  const hash = async (s: string) => createHash('sha256').update(s).digest('hex');
  const salt = () => randomBytes(8).toString('hex');

  it('accepts only 4 or 6 digits', () => {
    for (const ok of ['1234', '123456']) expect(isValidPin(ok)).toBe(true);
    for (const bad of ['123', '12345', '1234567', 'abcd', '12 4', '']) expect(isValidPin(bad)).toBe(false);
  });

  it('flags obvious PINs', () => {
    for (const weak of ['0000', '1111', '1234', '4321', '123456', '654321', '121212', '1212']) {
      expect(isWeakPin(weak)).toBe(true);
    }
    for (const fine of ['4827', '9150', '730194']) expect(isWeakPin(fine)).toBe(false);
  });

  it('stores a salted hash, never the PIN, and verifies correctly', async () => {
    const stored = await createStoredPin('4827', hash, salt);
    expect(JSON.stringify(stored)).not.toContain('4827');
    expect(stored.length).toBe(4);
    expect(await verifyPin(stored, '4827', hash)).toBe(true);
    expect(await verifyPin(stored, '4828', hash)).toBe(false);
    expect(await verifyPin(stored, '482700', hash)).toBe(false);
    expect(await verifyPin(stored, '', hash)).toBe(false);
  });

  it('the same PIN gets a different hash each time (salt)', async () => {
    const a = await createStoredPin('4827', hash, salt);
    const b = await createStoredPin('4827', hash, salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects creating an invalid PIN', async () => {
    await expect(createStoredPin('12', hash, salt)).rejects.toThrow(/4 or 6/);
  });

  it('lockout grows with repeated wrong PINs', () => {
    expect([0, 1, 4].map(lockoutSeconds)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 9, 20].map(lockoutSeconds)).toEqual([30, 60, 300, 900, 3600, 3600]);
  });

  it('locks after the chosen time away', () => {
    expect(shouldLockAfterAbsence(1000, 1000 + 59_000, 60)).toBe(false);
    expect(shouldLockAfterAbsence(1000, 1000 + 60_000, 60)).toBe(true);
    expect(shouldLockAfterAbsence(1000, 1001, 0)).toBe(true);
    expect(shouldLockAfterAbsence(null, 5, 900)).toBe(true);
  });
});
