import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog. Web uses window.confirm (synchronous);
 * iOS/Android use a native Alert (async) so destructive actions always get
 * a real confirmation instead of silently proceeding, as some screens did
 * before by only checking `Platform.OS === 'web'`.
 */
export function confirm(message, { title = '', confirmLabel = 'OK', destructive = false } = {}) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
