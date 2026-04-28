import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ParamListBase, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import { plcService } from '../services/PlcService';
import { ScannerMode, useSettingsStore } from '../store/settingsStore';
import { APP_VERSION, BUILD_NUMBER } from '../version';

const HEARTBEAT_MIN = 1;
const HEARTBEAT_MAX = 10;
const TEST_CONNECTION_TIMEOUT_MS = 4000;
const SCANNER_MODES: ScannerMode[] = ['hardware', 'camera', 'auto'];

function clampHeartbeat(value: number): number {
  return Math.min(HEARTBEAT_MAX, Math.max(HEARTBEAT_MIN, Math.round(value)));
}

function formatScannerModeLabel(mode: ScannerMode): string {
  if (mode === 'hardware') {
    return 'Hardware';
  }
  if (mode === 'camera') {
    return 'Camera';
  }
  return 'Auto';
}

type HeartbeatSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

type PlcServiceEvents = {
  on: (event: 'connectionChange', listener: (state: string) => void) => void;
  off: (event: 'connectionChange', listener: (state: string) => void) => void;
};

const plcServiceEvents = plcService as unknown as PlcServiceEvents;

function HeartbeatSlider({
  value,
  onChange,
}: HeartbeatSliderProps): React.JSX.Element {
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  const updateFromPosition = (locationX: number) => {
    const width = trackWidthRef.current;
    if (!width) {
      return;
    }

    const ratio = Math.min(1, Math.max(0, locationX / width));
    const nextValue = clampHeartbeat(HEARTBEAT_MIN + ratio * (HEARTBEAT_MAX - HEARTBEAT_MIN));
    onChange(nextValue);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => updateFromPosition(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateFromPosition(event.nativeEvent.locationX),
      }),
    [onChange],
  );

  const sliderRatio = (value - HEARTBEAT_MIN) / (HEARTBEAT_MAX - HEARTBEAT_MIN);
  const fillWidth = trackWidth * sliderRatio;
  const thumbLeft = Math.max(0, fillWidth);

  return (
    <View style={styles.sliderBlock}>
      <View
        {...panResponder.panHandlers}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          trackWidthRef.current = width;
          setTrackWidth(width);
        }}
        style={styles.sliderTrack}
      >
        <View style={[styles.sliderFill, { width: fillWidth }]} />
        <View style={[styles.sliderThumb, { left: thumbLeft }]} />
      </View>
      <View style={styles.sliderMarkers}>
        {Array.from({ length: HEARTBEAT_MAX }, (_, index) => index + 1).map((marker) => (
          <Pressable
            key={marker}
            onPress={() => onChange(marker)}
            style={styles.sliderMarkerButton}
          >
            <Text
              style={[
                styles.sliderMarkerText,
                marker === value && styles.sliderMarkerTextActive,
              ]}
            >
              {marker}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const plcIp = useSettingsStore((state) => state.plcIp);
  const plcPort = useSettingsStore((state) => state.plcPort);
  const scannerMode = useSettingsStore((state) => state.scannerMode);
  const heartbeatIntervalSec = useSettingsStore((state) => state.heartbeatIntervalSec);
  const hwScannerIntentAction = useSettingsStore((state) => state.hwScannerIntentAction);
  const setPlcIp = useSettingsStore((state) => state.setPlcIp);
  const setPlcPort = useSettingsStore((state) => state.setPlcPort);
  const setScannerMode = useSettingsStore((state) => state.setScannerMode);
  const setHeartbeatIntervalSec = useSettingsStore((state) => state.setHeartbeatIntervalSec);
  const setHwScannerIntentAction = useSettingsStore((state) => state.setHwScannerIntentAction);

  const [draftPlcIp, setDraftPlcIp] = useState(plcIp);
  const [draftPlcPort, setDraftPlcPort] = useState(String(plcPort));
  const [draftScannerMode, setDraftScannerMode] = useState<ScannerMode>(scannerMode);
  const [draftHeartbeatIntervalSec, setDraftHeartbeatIntervalSec] = useState(heartbeatIntervalSec);
  const [draftIntentAction, setDraftIntentAction] = useState(hwScannerIntentAction);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  useEffect(() => {
    setDraftPlcIp(plcIp);
    setDraftPlcPort(String(plcPort));
    setDraftScannerMode(scannerMode);
    setDraftHeartbeatIntervalSec(heartbeatIntervalSec);
    setDraftIntentAction(hwScannerIntentAction);
  }, [heartbeatIntervalSec, hwScannerIntentAction, plcIp, plcPort, scannerMode]);

  const handleSave = () => {
    const trimmedIp = draftPlcIp.trim();
    const parsedPort = Number.parseInt(draftPlcPort, 10);
    const trimmedIntentAction = draftIntentAction.trim();

    if (!trimmedIp) {
      Alert.alert('Invalid PLC IP', 'Enter a PLC IP address before saving.');
      return;
    }

    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      Alert.alert('Invalid Port', 'Enter a port from 1 to 65535.');
      return;
    }

    setPlcIp(trimmedIp);
    setPlcPort(parsedPort);
    setScannerMode(draftScannerMode);
    setHeartbeatIntervalSec(draftHeartbeatIntervalSec);
    setHwScannerIntentAction(trimmedIntentAction);

    Alert.alert('Settings Saved', 'Settings have been persisted to local storage.');
  };

  const handleTestConnection = async () => {
    const trimmedIp = draftPlcIp.trim();
    const parsedPort = Number.parseInt(draftPlcPort, 10);

    if (!trimmedIp) {
      Alert.alert('Invalid PLC IP', 'Enter a PLC IP address before testing.');
      return;
    }

    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      Alert.alert('Invalid Port', 'Enter a port from 1 to 65535.');
      return;
    }

    setIsTestingConnection(true);

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          plcServiceEvents.off('connectionChange', onConnectionChange);
          callback();
        };

        const onConnectionChange = (state: string) => {
          if (state === 'connected') {
            finish(resolve);
            plcService.disconnect();
            return;
          }

          if (state === 'disconnected') {
            finish(() => reject(new Error('Connection failed or was closed immediately.')));
          }
        };

        const timeoutId = setTimeout(() => {
          finish(() => reject(new Error('Connection test timed out.')));
          plcService.disconnect();
        }, TEST_CONNECTION_TIMEOUT_MS);

        plcServiceEvents.on('connectionChange', onConnectionChange);
        plcService.connect(trimmedIp, parsedPort);
      });

      Alert.alert('Connection Successful', `Connected to ${trimmedIp}:${parsedPort}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connection error.';
      Alert.alert('Connection Failed', message);
    } finally {
      plcService.disconnect();
      setIsTestingConnection(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [
          styles.backButton,
          pressed && styles.backButtonPressed,
        ]}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PLC Connection</Text>

          <Text style={styles.label}>PLC IP address</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={setDraftPlcIp}
            placeholder="192.168.1.100"
            placeholderTextColor="#7f8795"
            style={styles.input}
            value={draftPlcIp}
          />

          <Text style={styles.label}>Port</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setDraftPlcPort}
            placeholder="8500"
            placeholderTextColor="#7f8795"
            style={styles.input}
            value={draftPlcPort}
          />

          <Pressable
            disabled={isTestingConnection}
            onPress={handleTestConnection}
            style={({ pressed }) => [
              styles.secondaryButton,
              isTestingConnection && styles.buttonDisabled,
              pressed && !isTestingConnection && styles.secondaryButtonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>
              {isTestingConnection ? 'Testing...' : 'Test Connection'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scanner Mode</Text>
          <View style={styles.modeRow}>
            {SCANNER_MODES.map((mode) => {
              const selected = draftScannerMode === mode;

              return (
                <Pressable
                  key={mode}
                  onPress={() => setDraftScannerMode(mode)}
                  style={({ pressed }) => [
                    styles.modeButton,
                    selected && styles.modeButtonSelected,
                    pressed && !selected && styles.modeButtonPressed,
                  ]}
                >
                  <Text style={[styles.modeButtonText, selected && styles.modeButtonTextSelected]}>
                    {formatScannerModeLabel(mode)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Advanced</Text>

          <Text style={styles.label}>Hardware scanner intent action</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDraftIntentAction}
            placeholder="com.pacscanner.SCAN"
            placeholderTextColor="#7f8795"
            style={[styles.input, styles.inputMultiline]}
            value={draftIntentAction}
          />

          <View style={styles.heartbeatHeader}>
            <Text style={styles.label}>Heartbeat interval</Text>
            <Text style={styles.heartbeatValue}>{draftHeartbeatIntervalSec}s</Text>
          </View>
          <HeartbeatSlider
            onChange={setDraftHeartbeatIntervalSec}
            value={draftHeartbeatIntervalSec}
          />
        </View>

        <Pressable onPress={handleSave} style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
        ]}>
          <Text style={styles.primaryButtonText}>Save</Text>
        </Pressable>

        <Text style={styles.versionText}>v{APP_VERSION} ({BUILD_NUMBER})</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef2f8',
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#dbe3f0',
  },
  backButtonPressed: {
    opacity: 0.8,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a2744',
  },
  title: {
    marginTop: 16,
    marginBottom: 20,
    fontSize: 30,
    fontWeight: '800',
    color: '#1a2744',
  },
  section: {
    marginBottom: 18,
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#ffffff',
  },
  sectionTitle: {
    marginBottom: 16,
    fontSize: 20,
    fontWeight: '800',
    color: '#1a2744',
  },
  label: {
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#2f3b52',
  },
  input: {
    minHeight: 48,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#c8d1df',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8faff',
    fontSize: 16,
    color: '#152033',
  },
  inputMultiline: {
    minHeight: 56,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a2744',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryButtonPressed: {
    backgroundColor: '#ebf1fb',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a2744',
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: '#1a2744',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonPressed: {
    backgroundColor: '#263960',
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c8d1df',
    backgroundColor: '#f8faff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  modeButtonSelected: {
    borderColor: '#1a2744',
    backgroundColor: '#1a2744',
  },
  modeButtonPressed: {
    backgroundColor: '#e9effa',
  },
  modeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a2744',
  },
  modeButtonTextSelected: {
    color: '#ffffff',
  },
  heartbeatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heartbeatValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a2744',
  },
  sliderBlock: {
    paddingTop: 8,
  },
  sliderTrack: {
    height: 36,
    borderRadius: 18,
    backgroundColor: '#d9e2ef',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: '#4f78c7',
  },
  sliderThumb: {
    position: 'absolute',
    marginLeft: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#1a2744',
  },
  sliderMarkers: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderMarkerButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sliderMarkerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6d7788',
  },
  sliderMarkerTextActive: {
    color: '#1a2744',
  },
  versionText: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 13,
    color: '#9aa3b0',
  },
});
