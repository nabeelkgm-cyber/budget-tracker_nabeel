import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { ColorValue, Platform, Pressable, View } from 'react-native';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const t = useTheme();
  const { width, isWide } = useBreakpoint();
  const tight = width < 480; // six tabs on a phone: smaller labels so none is cut off
  const sidebar = Platform.OS === 'web' && isWide; // wide window: tabs go down the left side

  const settingsButton = () => (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityLabel="Settings"
      hitSlop={12}
      style={{ marginRight: 16 }}>
      <Ionicons name="settings-outline" size={24} color={t.textMuted as string} />
    </Pressable>
  );
  const addButton = () => (
    <Pressable onPress={() => router.push('/transaction/new')} accessibilityLabel="Add transaction" hitSlop={12} style={{ marginRight: 16 }}>
      <Ionicons name="add-circle" size={30} color={t.primary as string} />
    </Pressable>
  );
  // Settings is always one tap away in the top bar, whatever sits at the bottom of the screen.
  const addAndSettings = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {settingsButton()}
      {addButton()}
    </View>
  );
  const icon = (name: string) => ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name as any} size={size} color={color as string} />
  );
  // In a browser the default bottom bar is too short and cuts off the labels; it also needs the iPhone's bottom safe area.
  const barStyle = (
    Platform.OS === 'web'
      ? sidebar
        ? { width: 210, paddingTop: 14, paddingHorizontal: 8 }
        : { height: 'auto', paddingTop: 8, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }
      : undefined
  ) as object | undefined;
  return (
    <Tabs
      screenOptions={{
        tabBarPosition: sidebar ? 'left' : 'bottom',
        tabBarLabelPosition: sidebar ? 'beside-icon' : undefined,
        tabBarActiveTintColor: t.primary,
        tabBarActiveBackgroundColor: sidebar ? `${t.primary}1F` : undefined,
        headerRight: addAndSettings,
        tabBarStyle: barStyle,
        tabBarLabelStyle: sidebar
          ? { fontSize: 14, fontWeight: '600', marginLeft: 6 }
          : Platform.OS === 'web'
            ? { fontSize: tight ? 10 : 11, lineHeight: 14, marginTop: 2 }
            : { fontSize: tight ? 10 : 11 },
        tabBarItemStyle: sidebar ? { borderRadius: 12, marginVertical: 2 } : tight ? { paddingHorizontal: 0 } : undefined,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarLabel: tight ? 'History' : 'Transactions', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', headerRight: settingsButton, tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="net-assets" options={{ title: 'Net assets', headerRight: settingsButton, tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', headerRight: settingsButton, tabBarIcon: icon('bar-chart') }} />
      <Tabs.Screen name="more" options={{ title: 'More', headerRight: settingsButton, tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
