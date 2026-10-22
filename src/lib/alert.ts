import { Alert as NativeAlert, Platform } from 'react-native';
import type { AlertButton } from 'react-native';

/**
 * Drop-in for react-native's Alert. On the web, react-native-web's Alert does nothing, so we use the
 * browser's own dialogs: confirm() when there are two or more buttons, alert() otherwise.
 */
function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const text = [title, message].filter(Boolean).join('\n\n');
  const list = buttons ?? [];
  if (list.length < 2) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }
  const cancel = list.find((b) => b.style === 'cancel');
  const action = [...list].reverse().find((b) => b !== cancel) ?? list[list.length - 1];
  if (window.confirm(text)) action.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    if (Platform.OS === 'web') webAlert(title, message, buttons);
    else NativeAlert.alert(title, message, buttons);
  },
};
