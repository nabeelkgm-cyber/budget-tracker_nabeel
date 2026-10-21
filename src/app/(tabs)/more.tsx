import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Card, Divider, IconCircle, Row, Screen } from '@/components/ui';
import { useTheme } from '@/theme';

export default function MoreScreen() {
  const t = useTheme();
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
