import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isWeakPin } from '@/domain/pin';
import { checkPin } from '@/services/lock';
import { useTheme } from '@/theme';
import { PinPad } from './PinPad';
import { Chip, ChipRow } from './ui';

export type PinFlowKind = 'enable' | 'change' | 'disable';
type Step = 'current' | 'new' | 'confirm';

/**
 * Walks through entering PINs: enable (new + confirm), change (current + new + confirm),
 * or turn off (current). Calls onDone with the new PIN (enable/change) or '' (disable).
 */
export function PinFlow({
  flow,
  currentLength,
  onCancel,
  onDone,
}: {
  flow: PinFlowKind | null;
  /** Length of the existing PIN (for the "current PIN" step). */
  currentLength: number;
  onCancel: () => void;
  onDone: (flow: PinFlowKind, newPin: string) => void;
}) {
  const t = useTheme();
  const [step, setStep] = useState<Step>('new');
  const [length, setLength] = useState(4);
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!flow) return;
    setStep(flow === 'enable' ? 'new' : 'current');
    setPin('');
    setFirstPin('');
    setMessage('');
    setLength(4);
  }, [flow]);

  if (!flow) return null;
  const activeLength = step === 'current' ? currentLength : length;

  const title =
    step === 'current'
      ? flow === 'disable'
        ? 'Enter your PIN to turn off the lock'
        : 'Enter your current PIN'
      : step === 'new'
        ? flow === 'change'
          ? 'Choose a new PIN'
          : 'Choose a PIN'
        : 'Enter the PIN again';

  const handle = async (value: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (step === 'current') {
        const r = await checkPin(value);
        if (!r.ok) {
          setMessage(r.waitSeconds > 0 ? `Too many wrong tries. Wait ${r.waitSeconds} seconds.` : 'Wrong PIN.');
          setPin('');
          return;
        }
        if (flow === 'disable') return onDone('disable', '');
        setStep('new');
        setMessage('');
        setPin('');
      } else if (step === 'new') {
        const proceed = () => {
          setFirstPin(value);
          setStep('confirm');
          setMessage('');
          setPin('');
        };
        if (isWeakPin(value)) {
          setPin('');
          Alert.alert('Easy to guess', 'This PIN is very easy to guess (like 1234 or 0000). Use a different one?', [
            { text: 'Choose another', style: 'cancel' },
            { text: 'Use it anyway', style: 'destructive', onPress: () => { setPin(''); proceed(); } },
          ]);
        } else proceed();
      } else {
        if (value !== firstPin) {
          setMessage('The PINs did not match. Start again.');
          setStep('new');
          setFirstPin('');
          setPin('');
          return;
        }
        onDone(flow, value);
      }
    } finally {
      setBusy(false);
    }
  };

  const change = (next: string) => {
    setPin(next);
    if (next.length === activeLength) handle(next);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20 }}>
        <View style={{ width: '100%', paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={{ color: t.primary, fontWeight: '700', fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
          {step === 'new' ? (
            <ChipRow>
              <Chip label="4 digits" selected={length === 4} onPress={() => { setLength(4); setPin(''); }} />
              <Chip label="6 digits" selected={length === 6} onPress={() => { setLength(6); setPin(''); }} />
            </ChipRow>
          ) : null}
          <Text style={{ color: message ? t.danger : t.textMuted, fontSize: 13, textAlign: 'center', minHeight: 36 }}>
            {message ||
              (step === 'new' && flow !== 'disable'
                ? 'There is no way to recover a forgotten PIN. Make a backup first.'
                : '')}
          </Text>
        </View>

        <PinPad value={pin} length={activeLength} onChange={change} disabled={busy} />
        <View style={{ height: 30 }} />
      </SafeAreaView>
    </Modal>
  );
}
