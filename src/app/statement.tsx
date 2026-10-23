import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Chip, ChipRow, Label, Loading, Screen, SectionTitle } from '@/components/ui';
import { listAccounts } from '@/db/repositories/accounts';
import { addBatch } from '@/db/repositories/inbox';
import { parseCsv } from '@/domain/csv';
import { convertStatementItems, displayAmount } from '@/domain/importConvert';
import { ColumnMapping, StatementField, detectColumns, extractStatementItems } from '@/domain/statement';
import { pdfItemsToGrid } from '@/domain/pdfTable';
import { readXlsx } from '@/domain/xlsxRead';
import { useDbQuery } from '@/hooks/useDbQuery';
import { pickFileBytes } from '@/services/files';
import { readPdfText } from '@/services/pdfText';
import { sha256 } from '@/services/hash';
import { useTheme } from '@/theme';

interface Loaded {
  name: string;
  kind: 'csv' | 'xlsx' | 'pdf';
  sheets: { name: string; rows: string[][] }[];
}

const FIELDS: { field: StatementField; label: string; hint?: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'description', label: 'Description' },
  { field: 'debit', label: 'Debit (money out)', hint: 'if debit and credit are separate columns' },
  { field: 'credit', label: 'Credit (money in)' },
  { field: 'amount', label: 'Amount', hint: 'if there is one amount column' },
  { field: 'drcr', label: 'Dr/Cr marker' },
  { field: 'balance', label: 'Balance' },
  { field: 'reference', label: 'Reference' },
];

export default function StatementScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data: accounts } = useDbQuery((d) => listAccounts(d));
  const [file, setFile] = useState<Loaded | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = file?.sheets[sheetIdx]?.rows ?? [];
  const account = accounts?.find((a) => a.id === accountId);
  const extracted = useMemo(() => (mapping ? extractStatementItems(rows, mapping) : null), [rows, mapping]);
  const converted = useMemo(
    () => (extracted && account ? convertStatementItems(extracted.items, account.id, account.currency) : null),
    [extracted, account],
  );

  const choose = async () => {
    setBusy(true);
    try {
      const picked = await pickFileBytes();
      if (!picked) return;
      const isXlsx = /\.xlsx$/i.test(picked.name) || (picked.bytes[0] === 0x50 && picked.bytes[1] === 0x4b);
      if (/\.xls$/i.test(picked.name)) throw new Error('Old .xls files are not supported. Open it in Excel or Numbers and save as .xlsx or CSV.');
      let loaded: Loaded;
      if (/\.pdf$/i.test(picked.name) || String.fromCharCode(...picked.bytes.slice(0, 4)) === '%PDF') {
        const pages = await readPdfText(picked.bytes);
        if (!pages.some((p) => p.length)) throw new Error('This PDF has no readable text. It may be a scanned picture. Download the statement from your bank as a PDF with text, or as CSV or Excel.');
        const grid = pdfItemsToGrid(pages);
        if (!grid) throw new Error('Could not find the transaction table in this PDF (a row with Date, Description and Debit / Credit or Amount). Try the bank\'s CSV or Excel download instead.');
        loaded = { name: picked.name, kind: 'pdf', sheets: [{ name: 'PDF', rows: grid }] };
      } else {
        loaded = isXlsx
          ? { name: picked.name, kind: 'xlsx', sheets: readXlsx(picked.bytes).filter((s) => s.rows.some((r) => r.length)) }
          : { name: picked.name, kind: 'csv', sheets: [{ name: 'CSV', rows: parseCsv(new TextDecoder('utf-8').decode(picked.bytes)) }] };
      }
      if (!loaded.sheets.length || !loaded.sheets[0].rows.length) throw new Error('The file has no data.');
      setFile(loaded);
      setSheetIdx(0);
      setMapping(detectColumns(loaded.sheets[0].rows));
      setAdjust(false);
    } catch (e) {
      Alert.alert('Could not read the file', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const pickSheet = (i: number) => {
    setSheetIdx(i);
    setMapping(file ? detectColumns(file.sheets[i].rows) : null);
  };

  const setColumn = (field: StatementField, index: number | undefined) => {
    if (!mapping) return;
    const columns = { ...mapping.columns };
    if (index === undefined) delete columns[field];
    else columns[field] = index;
    setMapping({ ...mapping, columns });
  };

  const header = mapping ? (rows[mapping.headerRow] ?? []) : [];

  const add = async () => {
    if (!file || !account || !converted) return;
    setBusy(true);
    try {
      const hash = await sha256(JSON.stringify([account.id, rows]));
      const r = await addBatch(db, { source: file.kind, fileName: file.name, fileHash: hash, accountId: account.id }, converted.items);
      Alert.alert(
        'Added for review',
        `${r.pending} to review${r.possible ? ` (${r.possible} look like entries you already have)` : ''}\n${r.duplicates} skipped as already recorded`,
        [{ text: 'Review now', onPress: () => router.replace('/inbox') }],
      );
    } catch (e) {
      Alert.alert('Could not add', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (!accounts) return <Loading />;
  const n = converted?.items.length ?? 0;

  return (
    <Screen>
      <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
        Import a bank or card statement as a PDF, Excel (.xlsx) or CSV file. PDFs are read on your device (in the web app); check the preview below, because layouts differ between banks. Lines are checked against what you already
        have and added to the review inbox. Nothing is saved to your books until you approve it.
      </Text>
      <Button title={file ? 'Choose a different file…' : 'Choose statement file…'} onPress={choose} disabled={busy} />

      {file ? (
        <>
          <SectionTitle>{file.name}</SectionTitle>
          {file.sheets.length > 1 ? (
            <>
              <Label>Sheet</Label>
              <ChipRow>
                {file.sheets.map((s, i) => (
                  <Chip key={s.name} label={s.name} selected={sheetIdx === i} onPress={() => pickSheet(i)} />
                ))}
              </ChipRow>
            </>
          ) : null}

          <Label>Which account is this statement for?</Label>
          <ChipRow>
            {accounts.map((a) => (
              <Chip key={a.id} label={`${a.name} (${a.currency})`} color={a.color} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
            ))}
          </ChipRow>

          {!mapping ? (
            <Card style={{ padding: 16 }}>
              <Text style={{ color: t.danger, fontWeight: '700' }}>Could not find the columns automatically.</Text>
              <Text style={{ color: t.textMuted, marginVertical: 6 }}>
                The file needs a header row with at least a date and an amount (or debit and credit) column. You can pick them yourself.
              </Text>
              <Button title="Pick columns" kind="secondary" onPress={() => { setMapping({ headerRow: 0, columns: {} }); setAdjust(true); }} />
            </Card>
          ) : (
            <>
              <Button title={adjust ? 'Hide column settings' : 'Check or change the columns'} kind="secondary" onPress={() => setAdjust(!adjust)} />
              {adjust ? (
                <Card style={{ padding: 16 }}>
                  <Label>Header row number in the file</Label>
                  <ChipRow>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => (
                      <Chip key={r} label={String(r + 1)} selected={mapping.headerRow === r} onPress={() => setMapping({ headerRow: r, columns: {} })} />
                    ))}
                  </ChipRow>
                  {FIELDS.map(({ field, label, hint }) => (
                    <View key={field}>
                      <Label>
                        {label}
                        {hint ? ` (${hint})` : ''}
                      </Label>
                      <ChipRow>
                        <Chip label="none" selected={mapping.columns[field] === undefined} onPress={() => setColumn(field, undefined)} />
                        {header.map((h, i) =>
                          h.trim() ? <Chip key={i} label={h.trim().slice(0, 24)} selected={mapping.columns[field] === i} onPress={() => setColumn(field, i)} /> : null,
                        )}
                      </ChipRow>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          )}

          {extracted ? (
            <Card style={{ padding: 16 }}>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>
                {extracted.items.length} transaction line{extracted.items.length === 1 ? '' : 's'} found
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 8 }}>
                {extracted.skipped.length} row{extracted.skipped.length === 1 ? '' : 's'} skipped (totals, balances, blanks)
              </Text>
              {extracted.items.slice(0, 5).map((i) => (
                <View key={i.line} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <Text style={{ color: t.text, flex: 1, fontSize: 12 }} numberOfLines={1}>
                    {i.date} · {i.description}
                  </Text>
                  <Text style={{ color: i.direction === 'credit' ? t.income : t.expense, fontSize: 12, fontWeight: '700' }}>
                    {i.direction === 'credit' ? '+' : '-'}
                    {account ? displayAmount(i.amountText, account.currency) : i.amountText}
                  </Text>
                </View>
              ))}
              {converted?.problems.slice(0, 5).map((p) => (
                <Text key={p.line} style={{ color: t.danger, fontSize: 12 }}>
                  Line {p.line}: {p.message}
                </Text>
              ))}
            </Card>
          ) : null}

          <Button title={n > 0 ? `Add ${n} line${n === 1 ? '' : 's'} to the review inbox` : 'Add to the review inbox'} onPress={add} disabled={busy || !account || n === 0} />
          {!account ? <Text style={{ color: t.textMuted, fontSize: 12 }}>Choose the account first.</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}
