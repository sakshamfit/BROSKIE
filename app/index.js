import { registerRootComponent } from 'expo';
import { LogBox, Platform } from 'react-native';

import App from './App';

// On-device testing (Expo Go / dev clients / preview builds) otherwise pops
// yellow LogBox warning overlays onto the screen — e.g. benign network or
// font warnings while signing in — which users experience as "pop up
// messages" mid-flow. All real user-facing errors are rendered inline in the
// UI, so suppress the overlay on native dev builds. Comment out to restore
// the dev warning overlay.
if (Platform.OS !== 'web' && __DEV__) {
  LogBox.ignoreAllLogs();
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
