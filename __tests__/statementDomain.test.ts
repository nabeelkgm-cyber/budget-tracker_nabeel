import { strToU8, zipSync } from 'fflate';
import { bestMatch, referenceKey, similarity } from '@/domain/dedupe';
import { parseSms, splitMessages } from '@/domain/sms';
import {
  ColumnMapping,
  detectColumns,
  extractStatementItems,
  merchantKey,
  parseAmountText,
  parseStatementDate,
} from '@/domain/statement';
import { buildXlsx } from '@/domain/xlsx';
import { readXlsx, serialToIso } from '@/domain/xlsxRead';

describe('parseAmountText', () => {
  it.each([
    ['1,234.56', '1234.56', 0],
    ['1,23,456.78', '123456.78', 0], // Indian grouping
    ['(1,200.00)', '1200.00', -1],
    ['-500', '500', -1],
    ['500.00 Dr', '500.00', -1],
    ['500.00 CR', '500.00', 1],
    ['Rs. 1,000', '1000', 0],
    ['QAR 12.500', '12.500', 0],
    ['1.234,56', '1234.56', 0], // European
    ['1 234,50', '1234.50', 0],
    ['12,5', '12.5', 0],
    ['1,234', '1234', 0],
    ['0.5', '0.5', 0],
    ['₹2,500.00', '2500.00', 0],
  ])('%s -> %s (sign %i)', (input, value, sign) => {
    expect(parseAmountText(input)).toEqual({ value, sign });
  });
  it.each(['', 'abc', '--', 'Dr'])('rejects %p', (input) => expect(parseAmountText(input)).toBeNull());
});

describe('parseStatementDate', () => {
  it.each([
    ['2026-10-21', '2026-10-21'],
    ['21/10/2026', '2026-10-21'],
    ['21-10-26', '2026-10-21'],
    ['21.10.2026', '2026-10-21'],
    ['21 Oct 2026', '2026-10-21'],
    ['21-Oct-26', '2026-10-21'],
    ['21OCT26', '2026-10-21'],
    ['21-OCT-2026', '2026-10-21'],
    ['Oct 21, 2026', '2026-10-21'],
    ['21/10/2026 14:35:10', '2026-10-21'],
    ['2026-10-21T08:00:00', '2026-10-21'],
    ['1/2/2026', '2026-02-01'],
  ])('%s', (input, expected) => expect(parseStatementDate(input)).toBe(expected));
  it.each(['', '31/02/2026', '32/01/2026', 'Total', '21 Foo 2026', '2026'])('rejects %p', (input) =>
    expect(parseStatementDate(input)).toBeNull(),
  );
});

describe('detectColumns', () => {
  it('finds the header below the bank preamble, with separate debit and credit columns', () => {
    const rows = [
      ['Account Statement'],
      ['Account No', 'XXXX1234'],
      [],
      ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
      ['21/10/2026', '21/10/2026', 'UPI/SWIGGY', '123456', '250.00', '', '10,000.00'],
    ];
    const m = detectColumns(rows)!;
    expect(m.headerRow).toBe(3);
    expect(m.columns).toMatchObject({ date: 0, description: 2, reference: 3, debit: 4, credit: 5, balance: 6 });
  });
  it('finds a single amount column and a Dr/Cr marker', () => {
    const m = detectColumns([['Date', 'Narration', 'Amount', 'Dr/Cr', 'Closing Balance']])!;
    expect(m.columns).toMatchObject({ date: 0, description: 1, amount: 2, drcr: 3, balance: 4 });
  });
  it('returns null when there is no usable header', () => {
    expect(detectColumns([['a', 'b'], ['1', '2']])).toBeNull();
    expect(detectColumns([])).toBeNull();
  });
});

describe('extractStatementItems', () => {
  const mapDC: ColumnMapping = { headerRow: 0, columns: { date: 0, description: 1, debit: 2, credit: 3, balance: 4, reference: 5 } };

  it('reads debit and credit columns, skips totals and blank rows, reports why', () => {
    const rows = [
      ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Ref'],
      ['Opening Balance', '', '', '', '10,000.00', ''],
      ['21/10/2026', 'POS LULU HYPERMARKET', '125.50', '', '9,874.50', 'R1'],
      ['22/10/2026', 'SALARY OCT', '', '14,500.00', '24,374.50', 'R2'],
      ['', '', '', '', '', ''],
      ['23/10/2026', 'BAD ROW', '', '', '', ''],
      ['Total', '', '125.50', '14,500.00', '', ''],
    ];
    const r = extractStatementItems(rows, mapDC);
    expect(r.items.map((i) => [i.date, i.direction, i.amountText, i.reference, i.balanceText])).toEqual([
      ['2026-10-21', 'debit', '125.50', 'R1', '9874.50'],
      ['2026-10-22', 'credit', '14500.00', 'R2', '24374.50'],
    ]);
    expect(r.skipped.map((s) => s.line)).toEqual([2, 6, 7]);
  });

  it('uses signs, brackets and a Dr/Cr column for a single amount column', () => {
    const rows = [
      ['Date', 'Details', 'Amount', 'Type'],
      ['01/10/2026', 'A', '-10.00', ''],
      ['02/10/2026', 'B', '20.00', 'Cr'],
      ['03/10/2026', 'C', '(30.00)', ''],
      ['04/10/2026', 'D', '40.00', 'DR'],
      ['05/10/2026', 'E', '50.00 Cr', ''],
    ];
    const m = detectColumns(rows)!;
    const r = extractStatementItems(rows, m);
    expect(r.items.map((i) => `${i.direction}:${i.amountText}`)).toEqual(['debit:10.00', 'credit:20.00', 'debit:30.00', 'debit:40.00', 'credit:50.00']);
  });

  it('rejects a row with both debit and credit', () => {
    const r = extractStatementItems([['Date', 'Description', 'Debit', 'Credit'], ['01/10/2026', 'X', '5', '5']], { headerRow: 0, columns: { date: 0, description: 1, debit: 2, credit: 3 } });
    expect(r.items).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/both/);
  });
});

describe('merchantKey', () => {
  it.each([
    ['POS 4111XXXX1234 LULU HYPERMARKET DOHA QA', 'LULU HYPERMARKET'],
    ['UPI/DR/301234567890/SWIGGY/YESB/swiggy@ybl', 'SWIGGY'],
    ['UPI-AMAZON PAY INDIA-123456', 'AMAZON PAY INDIA'],
    ['NEFT CR-ACME CORP LTD-SALARY', 'ACME CORP LTD'],
    ['ATM WDL 0012 CASH WITHDRAWAL', 'ATM WDL 0012 CASH WITHDRAWAL'.slice(0, 30)],
  ])('%s', (input, expected) => expect(merchantKey(input)).toBe(expected));
  it('gives the same key for the same shop on different days', () => {
    expect(merchantKey('POS LULU HYPERMARKET 21/10 REF 8812')).toBe(merchantKey('POS 9999XXXX0000 LULU HYPERMARKET'));
  });
});

describe('SMS parsing', () => {
  it('HDFC-style UPI debit', () => {
    const r = parseSms('Rs.1,250.00 debited from a/c XX1234 on 21-10-26 to VPA swiggy@ybl (UPI Ref No 629012345678). Avl Bal Rs 15,000.50')!;
    expect(r).toMatchObject({ amountText: '1250.00', currency: 'INR', direction: 'debit', last4: '1234', date: '2026-10-21', merchant: 'swiggy@ybl', reference: '629012345678', balanceText: '15000.50' });
  });
  it('card spend with merchant and ISO date', () => {
    const r = parseSms('Spent Rs.499 On HDFC Bank Card 5678 At AMAZON PAY On 2026-10-20. Avl Lmt Rs 90,000')!;
    expect(r).toMatchObject({ amountText: '499', currency: 'INR', direction: 'debit', last4: '5678', date: '2026-10-20', merchant: 'AMAZON PAY' });
  });
  it('NEFT credit', () => {
    const r = parseSms('Dear Customer, your A/C X4321 is credited with Rs 25,000.00 on 21Oct26 by NEFT from ACME CORP. Avl Bal Rs 30,000')!;
    expect(r).toMatchObject({ amountText: '25000.00', direction: 'credit', last4: '4321', date: '2026-10-21', merchant: 'ACME CORP' });
  });
  it('Gulf card purchase with QAR', () => {
    const r = parseSms('Purchase of QAR 150.00 at LULU HYPERMARKET on 21/10/2026 with card ending 9876. Available balance QAR 2,500.00')!;
    expect(r).toMatchObject({ amountText: '150.00', currency: 'QAR', direction: 'debit', last4: '9876', date: '2026-10-21', merchant: 'LULU HYPERMARKET', balanceText: '2500.00' });
  });
  it('QR abbreviation and 3-decimal currency', () => {
    expect(parseSms('QR 75.50 spent at CAREEM on 21-10-2026 card **1111')).toMatchObject({ currency: 'QAR', amountText: '75.50', last4: '1111' });
    expect(parseSms('OMR 12.500 debited from your account ending 7788 at SHELL on 21/10/26')).toMatchObject({ currency: 'OMR', amountText: '12.500', last4: '7788', merchant: 'SHELL' });
  });
  it('amount after the currency code, and the balance is never mistaken for the amount', () => {
    expect(parseSms('AED 300.00 credited to your account ending 5555. Balance: AED 9,999.00')).toMatchObject({ amountText: '300.00', direction: 'credit', balanceText: '9999.00' });
  });
  it('ignores OTPs, offers and messages without a clear debit or credit', () => {
    expect(parseSms('Your OTP is 123456. Do not share it with anyone.')).toBeNull();
    expect(parseSms('Get 20% cashback up to Rs 500 on your next purchase!')).toBeNull();
    expect(parseSms('Your account balance is QAR 1,000.00')).toBeNull();
    expect(parseSms('')).toBeNull();
  });
  it('splits pasted text into separate messages', () => {
    const msgs = splitMessages('First message\nstill first\n\n\nSecond message\n\nThird');
    expect(msgs).toEqual(['First message still first', 'Second message', 'Third']);
  });
});

describe('duplicate matching', () => {
  const item = { date: '2026-10-21', amountMinor: 12_550, direction: 'debit' as const, description: 'POS LULU HYPERMARKET DOHA', reference: null };
  const cand = (over: Record<string, unknown> = {}) => ({ id: 'c1', date: '2026-10-21', amountMinor: 12_550, direction: 'debit' as const, note: 'Lulu Hypermarket', externalRef: null, ...over });

  it('similar wording', () => {
    expect(similarity('POS LULU HYPERMARKET DOHA', 'Lulu Hypermarket')).toBe(1);
    expect(similarity('POS LULU HYPERMARKET', 'Petrol')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
  });
  it('same day, amount and wording: exact', () => {
    expect(bestMatch(item, [cand()]).kind).toBe('exact');
  });
  it('same bank reference: exact whatever the date or wording', () => {
    const m = bestMatch({ ...item, reference: 'abc123456', date: '2026-10-25' }, [cand({ date: '2026-10-10', note: 'x', amountMinor: 1, externalRef: referenceKey('ABC123456') })]);
    expect(m.kind).toBe('exact');
  });
  it('same amount a day or two later with different wording: possible, closest first', () => {
    const m = bestMatch(item, [cand({ id: 'far', date: '2026-10-24', note: 'x' }), cand({ id: 'near', date: '2026-10-22', note: 'Lunch' })]);
    expect([m.kind, m.candidate!.id]).toEqual(['possible', 'near']);
  });
  it('different amount, opposite direction, or too many days apart: none', () => {
    expect(bestMatch(item, [cand({ amountMinor: 12_551 })]).kind).toBe('none');
    expect(bestMatch(item, [cand({ direction: 'credit' })]).kind).toBe('none');
    expect(bestMatch(item, [cand({ date: '2026-10-30' })]).kind).toBe('none');
  });
  it('a transaction already matched to another item is not reused', () => {
    expect(bestMatch(item, [cand()], new Set(['c1'])).kind).toBe('none');
  });
});

describe('reading .xlsx files', () => {
  it('reads what this app writes: text, numbers, dates, unicode', () => {
    const bytes = buildXlsx([{ name: 'Statement', columns: [{ header: 'Date', kind: 'date' }, { header: 'Description' }, { header: 'Amount', kind: 'amount2' }], rows: [['2026-10-21', 'Café & مطعم', 125.5], ['2026-10-22', 'x', null]] }]);
    const [sheet] = readXlsx(bytes);
    expect(sheet.name).toBe('Statement');
    expect(sheet.rows).toEqual([['Date', 'Description', 'Amount'], ['2026-10-21', 'Café & مطعم', '125.5'], ['2026-10-22', 'x']]);
  });

  it('reads files made by other programs: shared strings, rich text, sparse cells, date styles', () => {
    const files: Record<string, Uint8Array> = {
      'xl/workbook.xml': strToU8('<workbook xmlns:r="x"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Date</t></si><si><t>Narration</t></si><si><r><t>UPI/</t></r><r><t>SWIGGY</t></r></si></sst>'),
      'xl/styles.xml': strToU8('<styleSheet><numFmts count="1"><numFmt numFmtId="170" formatCode="dd\\-mmm\\-yy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1"><v>5</v></c></row>' +
          '<row r="3"><c r="A3" s="1"><v>46316</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" s="2"><v>46317</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    };
    const [sheet] = readXlsx(zipSync(files));
    expect(sheet.rows[0]).toEqual(['Date', 'Narration', '', '5']);
    expect(sheet.rows[1]).toEqual([]);
    expect(sheet.rows[2]).toEqual(['2026-10-21', 'UPI/SWIGGY', '2026-10-22']);
  });

  it('gives a clear error for files that are not xlsx', () => {
    expect(() => readXlsx(strToU8('not a zip'))).toThrow(/not a valid .xlsx/);
  });

  it('serial dates', () => {
    expect(serialToIso(46316)).toBe('2026-10-21');
    expect(serialToIso(45658)).toBe('2025-01-01');
  });
});
