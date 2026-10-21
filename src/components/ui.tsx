import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { COLOR_CHOICES, ICON_CHOICES, useTheme } from '@/theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
    </KeyboardAvoidingView>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: t.bg }]}>
      <ActivityIndicator color={t.primary} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.sectionTitle, { color: t.textMuted }]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.label, { color: t.textMuted }]}>{children}</Text>;
}

export function Field(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={t.textMuted}
        {...rest}
        style={[styles.input, { backgroundColor: t.inputBg, color: t.text, borderColor: t.border }, style]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : 'transparent';
  const color = kind === 'primary' ? t.onPrimary : kind === 'danger' ? t.danger : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : t.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string;
  icon?: string;
}) {
  const t = useTheme();
  const accent = color ?? t.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? accent : t.border, backgroundColor: selected ? accent + '22' : t.card },
      ]}>
      {icon ? <Ionicons name={icon as any} size={14} color={selected ? accent : t.textMuted} /> : null}
      <Text style={{ color: selected ? accent : t.text, fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; color?: string }[];
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.inputBg }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: o.color ?? t.primary }]}>
            <Text style={{ color: on ? '#fff' : t.text, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconCircle({ icon, color, size = 40 }: { icon: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + '26',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Ionicons name={icon as any} size={size * 0.5} color={color} />
    </View>
  );
}

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  muted,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  muted?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : muted ? 0.55 : 1 }]}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 12 }} />;
}

export function EmptyText({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.textMuted, textAlign: 'center', padding: 24 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 16, overflow: 'hidden' },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 14, borderWidth: 1, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3, marginBottom: 16 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
});

export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={styles.chipRow}>
      {ICON_CHOICES.map((i) => (
        <Pressable key={i} onPress={() => onChange(i)} hitSlop={4} style={{ opacity: value === i ? 1 : 0.5 }}>
          <IconCircle icon={i} color={value === i ? color : t.textMuted} size={40} />
        </Pressable>
      ))}
    </View>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {COLOR_CHOICES.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          hitSlop={4}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: c,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: value === c ? 3 : 0,
            borderColor: '#ffffff88',
          }}>
          {value === c ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
        </Pressable>
      ))}
    </View>
  );
}
