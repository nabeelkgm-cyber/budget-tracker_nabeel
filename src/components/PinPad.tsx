import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/** Dots for the digits entered so far, and a 0-9 keypad. The parent owns the value. */
export function PinPad({
  value,
  length,
  onChange,
  disabled,
}: {
  value: string;
  length: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const press = (d: string) => {
    if (!disabled && value.length < length) onChange(value + d);
  };
  const back = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };
  const key = (label: string, onPress: () => void, content?: React.ReactNode) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label === '⌫' ? 'Delete' : label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 78,
        height: 78,
        borderRadius: 39,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.border : t.card,
        borderWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.4 : 1,
      })}>
      {content ?? <Text style={{ color: t.text, fontSize: 28, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
  const blank = <View key="blank" style={{ width: 78, height: 78 }} />;

  return (
    <View style={{ alignItems: 'center', gap: 28 }}>
      <View style={{ flexDirection: 'row', gap: 16, height: 20, alignItems: 'center' }}>
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 2,
              borderColor: t.primary,
              backgroundColor: i < value.length ? t.primary : 'transparent',
            }}
          />
        ))}
      </View>
      <View style={{ width: 78 * 3 + 36, flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d)))}
        {blank}
        {key('0', () => press('0'))}
        {key('⌫', back, <Ionicons name="backspace-outline" size={28} color={t.text as string} />)}
      </View>
    </View>
  );
}
