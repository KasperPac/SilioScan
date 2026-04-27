// ============================================================
// ScannerService.ts — Unified barcode source: hardware intent OR camera
// ARCHITECTURE.md §8.1, §5
//
// Sources:
//   Hardware — ScannerModule.kt BroadcastReceiver → RCTDeviceEventEmitter
//              event: "onBarcodeScanned"
//   Camera   — react-native-vision-camera useCodeScanner, driven by
//              CameraScanner component calling scannerService.reportCameraBarcode()
//
// Usage:
//   scannerService.configure('com.pacscanner.SCAN');
//   scannerService.switchMode('hardware');
//   const off = scannerService.onBarcode((code) => { ... });
//   // later:
//   off();
// ============================================================

import {
  DeviceEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';
import {
  type CodeScanner,
  useCodeScanner,
} from 'react-native-vision-camera';

// ── Types ────────────────────────────────────────────────────

export type ScannerMode = 'hardware' | 'camera';
export type BarcodeCallback = (barcode: string) => void;

// ── ScannerService ────────────────────────────────────────────

class ScannerService {
  private mode: ScannerMode = 'hardware';
  private callbacks = new Set<BarcodeCallback>();
  private hwSubscription: EmitterSubscription | null = null;

  constructor() {
    this._bindHardware();
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Pass the broadcast action emitted by the device's scan service to the
   * native BroadcastReceiver. Must be called before hardware scanning works.
   *
   * For Zebra (TC22), this is the action configured in the DataWedge profile's
   * Intent Output — a project-specific string we own, not a vendor constant.
   * Other vendors expose their own conventions:
   *   'com.pacscanner.SCAN'                          — Zebra DataWedge (this app)
   *   'com.honeywell.aidc.action.ACTION_CLAIM_SCANNER' — Honeywell
   *   'com.datalogic.decode.action.DECODE'           — Datalogic
   */
  configure(intentAction: string): void {
    const mod = NativeModules.ScannerModule as ScannerNativeModule | undefined;
    mod?.configure(intentAction);
  }

  /**
   * Switch between hardware-scanner and camera modes.
   * In 'hardware' mode, only BroadcastReceiver barcodes are forwarded.
   * In 'camera' mode, only camera barcodes (via reportCameraBarcode) are forwarded.
   */
  switchMode(mode: ScannerMode): void {
    this.mode = mode;
  }

  /** Get current mode. */
  getMode(): ScannerMode {
    return this.mode;
  }

  /**
   * Register a callback that fires whenever a barcode is scanned,
   * regardless of source.
   * Returns an unsubscribe function.
   */
  onBarcode(callback: BarcodeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Called by the CameraScanner component when vision-camera detects a code.
   * Forwards to callbacks only when mode === 'camera'.
   */
  reportCameraBarcode(barcode: string): void {
    if (this.mode !== 'camera') return;
    this._emit(barcode);
  }

  /**
   * Returns a CodeScanner config for use with react-native-vision-camera's
   * <Camera> component. Pass this directly to the `codeScanner` prop.
   *
   * Must be called inside a React component (it wraps useCodeScanner).
   * See CameraScanner.tsx for usage.
   */
  useCodeScannerConfig(): CodeScanner {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCodeScanner({
      codeTypes: ['qr', 'ean-13', 'ean-8', 'code-128', 'code-39', 'code-93', 'itf', 'data-matrix'],
      onCodeScanned: (codes) => {
        const value = codes[0]?.value;
        if (value) this.reportCameraBarcode(value);
      },
    });
  }

  // ── Internal ────────────────────────────────────────────────

  private _bindHardware(): void {
    this.hwSubscription = DeviceEventEmitter.addListener(
      'onBarcodeScanned',
      (barcode: string) => {
        if (this.mode === 'hardware') {
          this._emit(barcode);
        }
      },
    );
  }

  private _emit(barcode: string): void {
    this.callbacks.forEach((cb) => cb(barcode));
  }
}

// ── Native module type ────────────────────────────────────────

interface ScannerNativeModule {
  configure(intentAction: string): void;
}

// ── Singleton ─────────────────────────────────────────────────

export const scannerService = new ScannerService();

// Re-export hook type so CameraScanner.tsx can use it without importing vision-camera directly
export type { CodeScanner };
