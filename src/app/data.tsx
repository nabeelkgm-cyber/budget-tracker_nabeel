import dayjs from 'dayjs';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Loading, Screen, SectionTitle } from '@/components/ui';
import {
  ImportPreview,
  TRANSACTION_HEADERS,
  applyCsvImport,
  createBackup,
  exportCsv,
  exportWorkbookSheets,
  parseBackup,
  previewCsvImport,
  restoreBackup,
} from '@/db/repositories/dataTransfer';
import { toCsv } from '@/domain/csv';
import { buildXlsx } from '@/domain/xlsx';
import { useDbQuery } from '@/hooks/useDbQuery';
import { FILE_KINDS, pickTextFile, shareFile } from '@/services/files';
import { rescheduleReminders } from '@/services/notifications';
import { useTheme } from '@/theme';

const BOM = '﻿'; // makes Excel read the CSV as UTF-8 (Arabic and other non-English text)
const stamp = () => dayjs().format('YYYY-MM-DD');

export default function DataScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; result: ImportPreview } | null>(null);
  const { data: lastBackup } = useDbQuery(async (d) => {
    const r = await d.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'last_backup_at'");
    return r?.value ?? null;
  });

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (e) {
      Alert.alert('Something went wrong', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const backup = () =>
    run('Creating backup…', async () => {
      const text = await createBackup(db);
      await shareFile(`budget-tracker-backup-${dayjs().format('YYYY-MM-DD-HHmm')}.json`, text, FILE_KINDS.json);
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_at', ?)", [new Date().toISOString()]);
    });

  const restore = () =>
    run('Reading backup…', async () => {
      const picked = await pickTextFile();
      if (!picked) return;
      const { backup: b, summary } = parseBackup(picked.text);
      const when = summary.createdAt ? dayjs(summary.createdAt).format('D MMM YYYY, HH:mm') : 'unknown date';
      Alert.alert(
        'Replace ALL data with this backup?',
        `Backup from ${when}\n${summary.accounts} accounts · ${summary.transactions} transactions · ${summary.categories} categories · ${summary.budgets} budgets\nCurrency: ${summary.baseCurrency ?? '?'}\n\nEverything now in the app will be replaced. This cannot be undone. Make a backup of the current data first if you might need it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace everything',
            style: 'destructive',
            onPress: () =>
              run('Restoring…', async () => {
                await restoreBackup(db, b);
                await rescheduleReminders(db).catch(() => 0);
                Alert.alert('Restored', 'Your data has been restored.');
              }),
          },
        ],
      );
    });

  const exportExcel = () =>
    run('Building workbook…', async () => {
      const bytes = buildXlsx(await exportWorkbookSheets(db));
      await shareFile(`budget-tracker-${stamp()}.xlsx`, bytes, FILE_KINDS.xlsx);
    });

  const exportCsvFile = () =>
    run('Building CSV…', async () => {
      await shareFile(`budget-tracker-transactions-${stamp()}.csv`, BOM + (await exportCsv(db)), FILE_KINDS.csv);
    });

  const template = () =>
    run('Preparing template…', async () => {
      const rows = [
        ['Date', 'Type', 'Account', 'Amount', 'Category', 'Sub-category', 'To account', 'To amount', 'Payment method', 'Note'],
        [stamp(), 'Expense', 'Your account name', '12.50', 'Dining', '', '', '', 'card', 'Lunch'],
        [stamp(), 'Income', 'Your account name', '5000', 'Salary', '', '', '', 'bank_transfer', 'Salary'],
        [stamp(), 'Transfer', 'Your account name', '1000', '', '', 'Another account', '', 'bank_transfer', 'Move money'],
      ];
      await shareFile('budget-tracker-import-template.csv', BOM + toCsv(rows), FILE_KINDS.csv);
    });

  const chooseCsv = () =>
    run('Reading file…', async () => {
      const picked = await pickTextFile();
      if (!picked) return;
      setPreview({ name: picked.name, result: await previewCsvImport(db, picked.text) });
    });

  const confirmImport = () =>
    run('Importing…', async () => {
      if (!preview) return;
      const n = await applyCsvImport(db, preview.result);
      setPreview(null);
      Alert.alert('Imported', `${n} transaction${n === 1 ? '' : 's'} added.`);
    });

  const p = preview?.result;

  return (
    <Screen>
      {busy ? <Loading /> : null}

      <SectionTitle>Backup and restore</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          {lastBackup ? `Last backup: ${dayjs(lastBackup).format('D MMM YYYY, HH:mm')}. ` : 'No backup yet. '}
          A backup is one file with everything: accounts, transactions, budgets, recurring items and exchange rates.
          Save it to Files or iCloud Drive. It is not encrypted, so keep it private.
        </Text>
        <Button title="Create backup (JSON)" onPress={backup} disabled={!!busy} />
        <Button title="Restore from backup…" kind="secondary" onPress={restore} disabled={!!busy} />
      </Card>

      <SectionTitle>Export</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          Excel has separate sheets for transactions, accounts, categories and budgets, with real numbers and dates.
          CSV has the transactions only, in the same layout the import reads.
        </Text>
        <Button title="Export to Excel (.xlsx)" kind="secondary" onPress={exportExcel} disabled={!!busy} />
        <Button title="Export transactions (CSV)" kind="secondary" onPress={exportCsvFile} disabled={!!busy} />
      </Card>

      <SectionTitle>Import transactions from CSV</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          Needs a header row with Date, Type (Expense, Income or Transfer), Account and Amount. Category is needed for
          expenses and income, To account for transfers. Accounts and categories must already exist, and dates can be
          YYYY-MM-DD or DD/MM/YYYY. Anything already in the app is skipped, so importing the same file twice is safe.
          Bank statements will get their own review screen later.
        </Text>
        <Button title="Choose a CSV file…" onPress={chooseCsv} disabled={!!busy} />
        <Button title="Get a CSV template" kind="secondary" onPress={template} disabled={!!busy} />
      </Card>

      {p ? (
        <Card style={{ padding: 16 }}>
          <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>{preview!.name}</Text>
          {p.fatal ? (
            <Text style={{ color: t.danger, marginVertical: 10 }}>{p.fatal}</Text>
          ) : (
            <>
              <View style={{ marginVertical: 10, gap: 4 }}>
                <Text style={{ color: t.text }}>{p.totalRows} rows found</Text>
                <Text style={{ color: t.income, fontWeight: '700' }}>{p.toImport.length} new to import</Text>
                <Text style={{ color: t.textMuted }}>{p.duplicates} already in the app (skipped)</Text>
                <Text style={{ color: p.errors.length ? t.danger : t.textMuted }}>{p.errors.length} with problems (skipped)</Text>
              </View>
              {p.errors.slice(0, 10).map((e) => (
                <Text key={e.rowNumber} style={{ color: t.danger, fontSize: 12, marginBottom: 2 }}>
                  Row {e.rowNumber}: {e.message}
                </Text>
              ))}
              {p.errors.length > 10 ? (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>…and {p.errors.length - 10} more problems.</Text>
              ) : null}
              <View style={{ height: 12 }} />
              {p.toImport.length > 0 ? (
                <Button title={`Import ${p.toImport.length} transaction${p.toImport.length === 1 ? '' : 's'}`} onPress={confirmImport} disabled={!!busy} />
              ) : null}
            </>
          )}
          <Button title="Cancel" kind="secondary" onPress={() => setPreview(null)} />
        </Card>
      ) : null}
      <Text style={{ color: t.textMuted, fontSize: 12 }}>
        Columns read: {TRANSACTION_HEADERS.join(', ')}.
      </Text>
    </Screen>
  );
}
