import { Text } from 'react-native';
import { Screen, SectionTitle } from '@/components/ui';
import { SyncPanel } from '@/components/SyncPanel';
import { useTheme } from '@/theme';

export default function SyncScreen() {
  const t = useTheme();
  return (
    <Screen>
      <SectionTitle>Cloud sync</SectionTitle>
      <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
        Keeps the same accounts and transactions on all your devices. Changes are sent right after you make them, and
        the app still works without internet.
      </Text>
      <SyncPanel />
    </Screen>
  );
}
