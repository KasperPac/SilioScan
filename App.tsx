// ============================================================
// App.tsx — Root component
// Initialises services (PLC connection, scanner) on mount.
// Renders PickingScreen as the primary view.
// ============================================================

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { plcService } from './src/services/PlcService';
import { scannerService } from './src/services/ScannerService';
import PickingScreen from './src/screens/PickingScreen';
import { useSettingsStore } from './src/store/settingsStore';

function AppServices(): React.JSX.Element {
  const { plcIp, plcPort, hwScannerIntentAction, scannerMode } = useSettingsStore();

  // Connect to PLC using persisted settings
  useEffect(() => {
    plcService.connect(plcIp, plcPort);
    return () => { plcService.disconnect(); };
  }, [plcIp, plcPort]);

  // Configure hardware scanner intent
  useEffect(() => {
    scannerService.configure(hwScannerIntentAction);
    // Map 'auto' → 'hardware' (hardware scanner is the primary input method)
    scannerService.switchMode(scannerMode === 'camera' ? 'camera' : 'hardware');
  }, [hwScannerIntentAction, scannerMode]);

  return <PickingScreen />;
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a2744" />
      <AppServices />
    </SafeAreaProvider>
  );
}

const _styles = StyleSheet.create({
  // reserved for future root layout
});
