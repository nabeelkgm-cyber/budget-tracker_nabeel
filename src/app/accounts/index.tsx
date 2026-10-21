import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, Divider, IconCircle, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { formatMinor } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useTheme } from '@/theme';

export default function AccountsScreen() {
  const t = useTheme();
  const { data } = useDbQuery((db) => listAccounts(db, { includeArchived: true }));
  if (!data) return <Loading />;
  const active = data.filter((a) => !a.is_archived);
  const archived = data.filter((a) => a.is_archived);

  const list = (items: typeof data) => (
    <Card>
      {items.map((a, i) => (
        <View key={a.id}>
          {i > 0 ? <Divider /> : null}
          <Row
            muted={!!a.is_archived}
            onPress={() => router.push(`/accounts/${a.id}`)}
            left={<IconCircle icon={a.icon} color={a.color} />}
            title={a.name}
            subtitle={`${a.type.replace('_', ' ')} · ${a.currency}`}
            right={
              <>
                <Text style={{ color: a.balance_minor < 0 ? t.expense : t.text, fontWeight: '700' }}>
                  {formatMinor(a.balance_minor, a.currency)}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
              </>
            }
          />
        </View>
      ))}
    </Card>
  );

  return (
    <Screen>
      <Button title="+ Add account" onPress={() => router.push('/accounts/new')} />
      {active.length ? list(active) : null}
      {archived.length ? (
        <>
          <SectionTitle>Archived</SectionTitle>
          {list(archived)}
        </>
      ) : null}
    </Screen>
  );
}
