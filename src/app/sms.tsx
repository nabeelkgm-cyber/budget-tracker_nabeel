import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip, ChipRow, Label, Loading, Screen } from '@/components/ui';
import { listAccounts } from '@/db/repositories/accounts';
import { addBatch, addLast4, findAccountsByLast4, getAccountIdentifiers } from '@/db/repositories/inbox';
import { ConvertedItem, convertSms, displayAmount } from '@/domain/importConvert';
import { ParsedSms, parseSms, splitMessages } from '@/domain/sms';
import { useDbQuery } from '@/hooks/useDbQuery';
import { today } from '@/lib/dates';
import { sha256 } from '@/services/hash';
import { useTheme } from '@/theme';

interface Row {
  sms: ParsedSms;
  accountId: string | null;
  include: boolean;
  /** The account was picked by matching the card digits. */
  matched: boolean;
}

export default function SmsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data: accounts } = useDbQuery((d) => listAccounts(d));
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unread, setUnread] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!accounts) return <Loading />;

  const read = async () => {
    const parsed: Row[] = [];
    const failed: string[] = [];
    for (const msg of splitMessages(text)) {
      const sms = parseSms(msg);
      if (!sms) {
        failed.push(msg);
        continue;
      }
      let accountId: string | null = null;
      let matched = false;
      if (sms.last4) {
        const ids = await findAccountsByLast4(db, sms.last4);
        if (ids.length === 1) {
          accountId = ids[0];
          matched = true;
        }
      }
      if (!accountId && sms.currency) {
        // Only one account in that currency? Offer it, but do not mark it as matched.
        const same = accounts.filter((a) => a.currency === sms.currency);
        if (same.length === 1) accountId = same[0].id;
      }
      parsed.push({ sms, accountId, include: true, matched });
    }
    setRows(parsed);
    setUnread(failed);
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs?.map((r, k) => (k === i ? { ...r, ...patch } : r)) ?? null);

  const ready = (rows ?? []).filter((r) => r.include && r.accountId);

  const add = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const items: ConvertedItem[] = [];
      const errors: string[] = [];
      for (const r of ready) {
        const account = accounts.find((a) => a.id === r.accountId)!;
        const c = convertSms(r.sms, account.id, account.currency, today());
        if ('error' in c) errors.push(`${r.sms.merchant ?? r.sms.amountText}: ${c.error}`);
        else items.push(c);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      const hash = await sha256(JSON.stringify(ready.map((r) => [r.sms.raw, r.accountId])));
      const res = await addBatch(db, { source: 'sms', fileName: null, fileHash: hash, accountId: null }, items);

      // Offer to remember card digits that were not linked to the account yet.
      const toLearn: { accountId: string; last4: string }[] = [];
      for (const r of ready) {
        if (!r.matched && r.sms.last4 && r.accountId) {
          const have = (await getAccountIdentifiers(db, r.accountId)).last4;
          if (!have.includes(r.sms.last4) && !toLearn.some((x) => x.accountId === r.accountId && x.last4 === r.sms.last4)) {
            toLearn.push({ accountId: r.accountId, last4: r.sms.last4 });
          }
        }
      }
      const done = () => router.replace('/inbox');
      const message = `${res.pending} to review${res.possible ? ` (${res.possible} look like entries you already have)` : ''}\n${res.duplicates} skipped as already recorded`;
      if (toLearn.length) {
        Alert.alert('Added for review', `${message}\n\nRemember card digits ${toLearn.map((x) => `${x.last4} → ${accounts.find((a) => a.id === x.accountId)?.name}`).join(', ')} so future messages pick the account automatically?`, [
          { text: 'No', onPress: done },
          { text: 'Yes, remember', onPress: async () => { for (const x of toLearn) await addLast4(db, x.accountId, x.last4); done(); } },
        ]);
      } else Alert.alert('Added for review', message, [{ text: 'Review now', onPress: done }]);
    } catch (e) {
      Alert.alert('Could not add', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
        Copy bank SMS messages from the Messages app (long-press → Copy) and paste them here. Several messages can be
        pasted together with a blank line between them. Nothing is saved to your books until you approve it.
      </Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Paste bank messages here"
        placeholderTextColor={t.textMuted}
        style={{ minHeight: 140, textAlignVertical: 'top', backgroundColor: t.inputBg, color: t.text, borderRadius: 12, padding: 12, fontSize: 14, marginBottom: 12 }}
      />
      <Button title="Read the messages" onPress={read} disabled={!text.trim()} />

      {rows ? (
        <>
          {rows.map((r, i) => {
            const account = accounts.find((a) => a.id === r.accountId);
            return (
              <Card key={i} style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: r.sms.direction === 'credit' ? t.income : t.expense, fontWeight: '800', fontSize: 16 }}>
                      {r.sms.direction === 'credit' ? '+' : '-'}
                      {account ? displayAmount(r.sms.amountText, account.currency) : `${r.sms.currency ?? ''} ${r.sms.amountText}`}
                    </Text>
                    <Text style={{ color: t.text }}>{r.sms.merchant ?? 'Bank message'}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                      {r.sms.date ?? 'no date in the message: today will be used'}
                      {r.sms.last4 ? ` · card/account ending ${r.sms.last4}` : ''}
                    </Text>
                  </View>
                  <Switch value={r.include} onValueChange={(v) => update(i, { include: v })} />
                </View>
                {r.include ? (
                  <>
                    <Label>Account{r.matched ? ' (matched by the digits)' : ''}</Label>
                    <ChipRow>
                      {accounts.map((a) => (
                        <Chip key={a.id} label={a.name} color={a.color} selected={r.accountId === a.id} onPress={() => update(i, { accountId: a.id, matched: false })} />
                      ))}
                    </ChipRow>
                  </>
                ) : null}
              </Card>
            );
          })}
          {unread.length ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ color: t.textMuted, fontWeight: '700' }}>{unread.length} message{unread.length === 1 ? '' : 's'} not understood (not a debit or credit alert, or worded differently)</Text>
              {unread.map((m, i) => (
                <Text key={i} style={{ color: t.textMuted, fontSize: 11, marginTop: 6 }} numberOfLines={3}>
                  {m}
                </Text>
              ))}
            </Card>
          ) : null}
          {rows.length === 0 ? <Text style={{ color: t.textMuted }}>No debit or credit messages found in the text.</Text> : null}
          <Button title={ready.length ? `Add ${ready.length} to the review inbox` : 'Choose an account for each message'} onPress={add} disabled={busy || ready.length === 0} />
        </>
      ) : null}
    </Screen>
  );
}
