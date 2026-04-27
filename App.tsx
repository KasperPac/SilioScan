// ============================================================
// App.tsx — Root component
// Initialises services (PLC connection, scanner) on mount.
// Shows a branded splash screen briefly on launch, then renders
// PickingScreen as the primary view.
// ============================================================

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { plcService } from './src/services/PlcService';
import { scannerService } from './src/services/ScannerService';
import AppNavigator from './src/navigation/AppNavigator';
import SplashScreen from './src/components/SplashScreen';
import { useSettingsStore } from './src/store/settingsStore';

const SPLASH_DURATION_MS = 1500;

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

  return <AppNavigator />;
}

export default function App(): React.JSX.Element {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={showSplash ? 'dark-content' : 'light-content'}
        backgroundColor={showSplash ? '#ffffff' : '#1a2744'}
      />
      {showSplash ? (
        <SplashScreen />
      ) : (
        <NavigationContainer>
          <AppServices />
        </NavigationContainer>
      )}
    </SafeAreaProvider>
  );
}
