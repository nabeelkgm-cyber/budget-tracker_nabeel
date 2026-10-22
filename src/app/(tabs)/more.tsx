import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { Card, Divider, IconCircle, Row, Screen } from '@/components/ui';
import { pendingCount } from '@/db/repositories/inbox';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useTheme } from '@/theme';

export default function MoreScreen() {
  const t = useTheme();
  const { data: waiting } = useDbQuery(pendingCount);
  const chevron = <Ionicons name="chevron-forward" size={18} color={t.textMuted} />;
  return (
    <Screen>
      <Card>
        <Row
          left={<IconCircle icon="business" color="#0EA5E9" />}
          title="Accounts"
          subtitle="Cash, bank accounts, credit cards"
          right={chevron}
          onPress={() => router.push('/accounts')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="download" color="#F97316" />}
          title="Review inbox"
          subtitle="Bank statements and SMS waiting for approval"
          right={
            <>
              {waiting ? <Text style={{ color: t.primary, fontWeight: '800' }}>{waiting}</Text> : null}
              {chevron}
            </>
          }
          onPress={() => router.push('/inbox')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="repeat" color="#14B8A6" />}
          title="Recurring"
          subtitle="Rent, salary, subscriptions, remittances"
          right={chevron}
          onPress={() => router.push('/recurring')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="pricetags" color="#F59E0B" />}
          title="Categories"
          subtitle="Presets, sub-categories, icons, colours"
          right={chevron}
          onPress={() => router.push('/categories')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="cloud-download" color="#0EA5E9" />}
          title="Backup & data"
          subtitle="Backup, restore, Excel / CSV export and import"
          right={chevron}
          onPress={() => router.push('/data')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="sync" color="#6366F1" />}
          title="Cloud sync"
          subtitle="Same data on all your devices"
          right={chevron}
          onPress={() => router.push('/sync')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="lock-closed" color="#22C55E" />}
          title="App lock"
          subtitle="PIN and Face ID"
          right={chevron}
          onPress={() => router.push('/lock')}
        />
        <Divider />
        <Row
          left={<IconCircle icon="settings" color="#64748B" />}
          title="Settings"
          subtitle="Exchange rate, sample data"
          right={chevron}
          onPress={() => router.push('/settings')}
        />
      </Card>
    </Screen>
  );
}
