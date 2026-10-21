import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { ColorValue, Pressable } from 'react-native';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const t = useTheme();
  const addButton = () => (
    <Pressable onPress={() => router.push('/transaction/new')} hitSlop={12} style={{ marginRight: 16 }}>
      <Ionicons name="add-circle" size={30} color={t.primary as string} />
    </Pressable>
  );
  const icon = (name: string) => ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name as any} size={size} color={color as string} />
  );
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.primary, headerRight: addButton }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="more" options={{ title: 'More', headerRight: undefined, tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
