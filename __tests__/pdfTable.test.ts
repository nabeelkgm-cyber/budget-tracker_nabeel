import { pdfItemsToGrid, PdfTextItem } from '@/domain/pdfTable';
import { detectColumns, extractStatementItems } from '@/domain/statement';

/** Builds page items from rows of [x, text] at a given height, as pdf.js would report them. */
const line = (y: number, cells: [number, string][]): PdfTextItem[] =>
  cells.map(([x, str]) => ({ str, x, y, width: str.length * 5 }));

// Columns: Date x=40, Description x=120, Debit x=330, Credit x=400, Balance x=470
const header = (y: number) => line(y, [[40, 'Date'], [120, 'Description'], [330, 'Debit'], [400, 'Credit'], [470, 'Balance']]);

describe('pdfItemsToGrid', () => {
  const page1: PdfTextItem[] = [
    ...line(800, [[40, 'QNB Statement of account']]),
    ...line(780, [[40, 'Account: 1234567890  Currency: QAR']]),
    ...header(740),
    ...line(720, [[40, '01/10/2026'], [120, 'SALARY OCTOBER'], [405, '5,000.00'], [470, '5,800.00']]),
    ...line(700, [[40, '02/10/2026'], [120, 'POS LULU HYPERMARKET'], [335, '142.00'], [470, '5,658.00']]),
    ...line(688, [[120, 'DOHA QA']]), // wrapped description
    ...line(670, [[40, '03/10/2026'], [120, 'ATM WITHDRAWAL'], [335, '600.00'], [470, '5,058.00']]),
  ];
  const page2: PdfTextItem[] = [
    ...header(800), // repeated on the new page
    ...line(780, [[40, '05/10/2026'], [120, 'KAHRAMAA'], [335, '180.00'], [470, '4,878.00']]),
    ...line(740, [[120, 'Total'], [335, '922.00'], [405, '5,000.00']]),
  ];

  it('rebuilds a table with every value in its column', () => {
    const grid = pdfItemsToGrid([page1, page2])!;
    expect(grid[0]).toEqual(['Date', 'Description', 'Debit', 'Credit', 'Balance']);
    expect(grid[1]).toEqual(['01/10/2026', 'SALARY OCTOBER', '', '5,000.00', '5,800.00']);
    expect(grid[2]).toEqual(['02/10/2026', 'POS LULU HYPERMARKET DOHA QA', '142.00', '', '5,658.00']);
    expect(grid[3]).toEqual(['03/10/2026', 'ATM WITHDRAWAL', '600.00', '', '5,058.00']);
    expect(grid[4][1]).toBe('KAHRAMAA'); // the repeated header on page 2 is skipped
  });

  it('feeds the normal statement reader: debits out, credits in, totals ignored', () => {
    const grid = pdfItemsToGrid([page1, page2])!;
    const mapping = detectColumns(grid)!;
    const { items } = extractStatementItems(grid, mapping);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.amountText)).toEqual(['5000.00', '142.00', '600.00', '180.00']);
    expect(items.map((i) => i.direction)).toEqual(['credit', 'debit', 'debit', 'debit']);
    expect(items[1].description).toContain('LULU HYPERMARKET DOHA QA');
  });

  it('keeps a long description apart from the amount right next to it', () => {
    // The description runs almost up to the Debit column (as in real statements).
    const longDesc: PdfTextItem[] = [
      ...header(740),
      ...line(720, [[40, '02/10/2026'], [120, 'POS PURCHASE LULU HYPERMARKET DOHA QATAR'], [340, '142.00'], [470, '5,658.00']]),
    ];
    longDesc[6].width = 213; // the description ends at x=333, just 7 units before the amount
    const grid = pdfItemsToGrid([longDesc])!;
    expect(grid[1]).toEqual(['02/10/2026', 'POS PURCHASE LULU HYPERMARKET DOHA QATAR', '142.00', '', '5,658.00']);
  });

  it('returns null when there is no table header', () => {
    expect(pdfItemsToGrid([[...line(700, [[40, 'Just some text']])]])).toBeNull();
  });
});
