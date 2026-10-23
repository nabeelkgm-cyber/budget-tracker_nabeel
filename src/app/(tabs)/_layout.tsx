import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { ColorValue, Platform, Pressable } from 'react-native';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const t = useTheme();
  const { width } = useBreakpoint();
  const tight = width < 480; // six tabs on a phone: smaller labels so none is cut off
  const addButton = () => (
    <Pressable onPress={() => router.push('/transaction/new')} hitSlop={12} style={{ marginRight: 16 }}>
      <Ionicons name="add-circle" size={30} color={t.primary as string} />
    </Pressable>
  );
  const icon = (name: string) => ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name as any} size={size} color={color as string} />
  );
  // In a browser the default bar is too short and cuts off the labels; it also needs the iPhone's bottom safe area.
  const webBar = (Platform.OS === 'web'
    ? { height: 'auto', paddingTop: 8, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }
    : undefined) as object | undefined;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        headerRight: addButton,
        tabBarStyle: webBar,
        tabBarLabelStyle: Platform.OS === 'web' ? { fontSize: tight ? 10 : 11, lineHeight: 14, marginTop: 2 } : { fontSize: tight ? 10 : 11 },
        tabBarItemStyle: tight ? { paddingHorizontal: 0 } : undefined,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarLabel: tight ? 'History' : 'Transactions', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', headerRight: undefined, tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="net-assets" options={{ title: 'Net assets', headerRight: undefined, tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', headerRight: undefined, tabBarIcon: icon('bar-chart') }} />
      <Tabs.Screen name="more" options={{ title: 'More', headerRight: undefined, tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
