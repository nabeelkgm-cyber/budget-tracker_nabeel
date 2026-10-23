import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '@/theme';

const TABS = [
  { label: 'Home', icon: 'home', href: '/' },
  { label: 'Transactions', short: 'History', icon: 'list', href: '/transactions' },
  { label: 'Budget', icon: 'pie-chart', href: '/budget' },
  { label: 'Net assets', icon: 'wallet', href: '/net-assets' },
  { label: 'Reports', icon: 'bar-chart', href: '/reports' },
  { label: 'More', icon: 'menu', href: '/more' },
] as const;

const TAB_PATHS = new Set<string>(TABS.map((t) => t.href));

const SHADOW =
  Platform.OS === 'web'
    ? ({ boxShadow: '0 4px 24px rgba(15,23,42,0.22)' } as object)
    : { shadowColor: '#0F172A', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 };

/**
 * A floating bar with the main tabs, shown on every page that is not itself a tab (Add transaction,
 * Accounts, Settings...), so you can jump to another area without going back first.
 */
export function FloatingNav() {
  const path = usePathname();
  const t = useTheme();
  const { width } = useWindowDimensions();
  if (TAB_PATHS.has(path)) return null; // the normal tab bar is already there
  const tight = width < 480;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center', zIndex: 50 }}>
      <View
        style={[
          {
            flexDirection: 'row',
            width: '94%',
            maxWidth: 560,
            padding: 6,
            borderRadius: 30,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.border,
          },
          SHADOW,
        ]}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.href}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            onPress={() => router.navigate(tab.href as never)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: 7,
              borderRadius: 24,
              backgroundColor: pressed ? t.inputBg : 'transparent',
            })}>
            <Ionicons name={tab.icon as never} size={21} color={t.textMuted as string} />
            <Text style={{ color: t.textMuted, fontSize: tight ? 9.5 : 11, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
              {tight && 'short' in tab ? tab.short : tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
