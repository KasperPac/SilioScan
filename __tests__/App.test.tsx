/**
 * @format
 * Smoke test: App renders without crashing.
 * Services are mocked — this test only checks component tree construction.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// ── Service mocks ─────────────────────────────────────────────
// PlcService uses react-native-tcp-socket which has no native module in Jest.
jest.mock('../src/services/PlcService', () => ({
  plcService: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

jest.mock('../src/services/ScannerService', () => ({
  scannerService: {
    configure: jest.fn(),
    switchMode: jest.fn(),
    onBarcode: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../src/services/NfcService', () => ({
  nfcService: {
    startListening: jest.fn(() => Promise.resolve()),
    stopListening: jest.fn(),
    readTag: jest.fn(() => new Promise(() => {})), // never resolves in smoke test
  },
  NfcReadCancelledError: class NfcReadCancelledError extends Error {},
}));

// ── Native module mocks ───────────────────────────────────────
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: ({ component: Component }: { component: React.ComponentType }) => <Component />,
  }),
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: jest.fn(() => null),
  useCameraPermission: jest.fn(() => ({ hasPermission: false, requestPermission: jest.fn() })),
  useCodeScanner: jest.fn(() => ({})),
}));

jest.mock('react-native-nfc-manager', () => ({
  default: {
    isSupported: jest.fn(() => Promise.resolve(false)),
    start: jest.fn(() => Promise.resolve()),
    isEnabled: jest.fn(() => Promise.resolve(false)),
    setEventListener: jest.fn(),
  },
  NfcEvents: { DiscoverTag: 'NfcManagerDiscoverTag', SessionClosed: 'NfcManagerSessionClosed', StateChanged: 'NfcManagerStateChanged' },
  NfcTech: { Ndef: 'Ndef', NfcA: 'NfcA', NfcV: 'NfcV' },
}));

// ── Test ──────────────────────────────────────────────────────
test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
