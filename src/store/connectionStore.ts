// ============================================================
// connectionStore.ts — mirrors PlcService connection state in Zustand
// Updated by the app root when PlcService fires 'connectionChange'.
// ============================================================

import { create } from 'zustand';
import type { ConnectionState as PlcConnectionState } from '../services/PlcService';

interface ConnectionStore {
  status: PlcConnectionState;
  lastHeartbeatAt: number | null;
  setStatus: (status: PlcConnectionState) => void;
  heartbeatReceived: () => void;
}

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  status: 'disconnected',
  lastHeartbeatAt: null,

  setStatus: (status) => set({ status }),
  heartbeatReceived: () => set({ lastHeartbeatAt: Date.now() }),
}));
