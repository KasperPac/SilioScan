// ============================================================
// settingsStore.ts — persisted app settings via MMKV
// Persists: PLC IP, port, scanner mode, HW intent action.
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';

// ── MMKV storage adapter ──────────────────────────────────────

const mmkv = createMMKV({ id: 'pac-scanner-settings' });

const mmkvStorage = {
  getItem: (name: string): string | null => mmkv.getString(name) ?? null,
  setItem: (name: string, value: string): void => mmkv.set(name, value),
  removeItem: (name: string): void => { mmkv.remove(name); },
};

// ── Types ────────────────────────────────────────────────────

export type ScannerMode = 'hardware' | 'camera' | 'auto';

interface SettingsState {
  plcIp: string;
  plcPort: number;
  scannerMode: ScannerMode;
  heartbeatIntervalSec: number;

  /** Configurable per vendor — e.g. Zebra DataWedge, Honeywell, Datalogic. */
  hwScannerIntentAction: string;

  setPlcIp: (ip: string) => void;
  setPlcPort: (port: number) => void;
  setScannerMode: (mode: ScannerMode) => void;
  setHeartbeatIntervalSec: (seconds: number) => void;
  setHwScannerIntentAction: (action: string) => void;
}

// ── Store ────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      plcIp: '192.168.1.100',
      plcPort: 8500,
      scannerMode: 'auto',
      heartbeatIntervalSec: 5,
      hwScannerIntentAction: 'com.symbol.datawedge.api.ACTION',

      setPlcIp: (plcIp) => set({ plcIp }),
      setPlcPort: (plcPort) => set({ plcPort }),
      setScannerMode: (scannerMode) => set({ scannerMode }),
      setHeartbeatIntervalSec: (heartbeatIntervalSec) => set({ heartbeatIntervalSec }),
      setHwScannerIntentAction: (hwScannerIntentAction) => set({ hwScannerIntentAction }),
    }),
    {
      name: 'pac-scanner-settings',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
