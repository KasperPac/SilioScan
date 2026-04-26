// ============================================================
// NfcService.ts — NFC tag UID read for operator sign-off
// ARCHITECTURE.md §8.2
//
// Tags: HF 13.56 MHz (MIFARE/NTAG) — NFC-A compatible Android
// Operator ID: tag UID, hex string, max 16 chars
//   → maps to the 16-byte operatorId field in INGREDIENT_SIGNOFF
//
// Flow:
//   1. READY_FOR_SIGNOFF → NfcSignoffPrompt calls nfcService.readTag()
//   2. Operator taps tag → UID resolved → pickingStore.onNfcTapped(uid)
//   3. PlcService.sendIngredientSignoff() fires
//   4. SIGNOFF_ACK → pickingStore.onSignoffAck()
//
// Events:
//   'nfcReady'    ()             — NFC initialised and enabled
//   'nfcDisabled' ()             — NFC not enabled in system settings
//   'tagRead'     (uid: string)  — tag successfully read
//   'tagError'    (err: Error)   — read failed or was cancelled
// ============================================================

import { EventEmitter } from 'events';
import NfcManager, { NfcEvents, NfcTech, type TagEvent } from 'react-native-nfc-manager';

// ── Error types ───────────────────────────────────────────────

export class NfcNotSupportedError extends Error {
  constructor() { super('NFC is not supported on this device'); this.name = 'NfcNotSupportedError'; }
}

export class NfcDisabledError extends Error {
  constructor() { super('NFC is disabled — please enable it in Settings'); this.name = 'NfcDisabledError'; }
}

export class NfcReadCancelledError extends Error {
  constructor() { super('NFC read cancelled'); this.name = 'NfcReadCancelledError'; }
}

export class NfcReadTimeoutError extends Error {
  constructor() { super('NFC read timed out'); this.name = 'NfcReadTimeoutError'; }
}

// ── Constants ─────────────────────────────────────────────────

/** Max operator ID chars — matches the 16-byte protocol field. */
const OPERATOR_ID_MAX_LEN = 16;

/** Milliseconds to wait for a tag tap before rejecting. */
const READ_TIMEOUT_MS = 30_000;

// ── NfcService ────────────────────────────────────────────────

class NfcService extends EventEmitter {
  private started = false;
  private readInProgress = false;
  private readTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Initialise NFC and start monitoring state changes.
   * Safe to call multiple times — subsequent calls are no-ops.
   * Emits 'nfcReady' on success or 'nfcDisabled' if NFC is off.
   */
  async startListening(): Promise<void> {
    if (this.started) return;

    const supported = await NfcManager.isSupported();
    if (!supported) throw new NfcNotSupportedError();

    await NfcManager.start();
    this.started = true;

    // Monitor NFC enable/disable from system settings
    NfcManager.setEventListener(NfcEvents.StateChanged, (evt: { state: string }) => {
      if (evt.state === 'on' || evt.state === 'turning_on') {
        this.emit('nfcReady');
      } else if (evt.state === 'off' || evt.state === 'turning_off') {
        this.emit('nfcDisabled');
      }
    });

    const enabled = await NfcManager.isEnabled();
    if (enabled) {
      this.emit('nfcReady');
    } else {
      this.emit('nfcDisabled');
    }
  }

  /**
   * Stop NFC discovery and cancel any in-progress read.
   */
  stopListening(): void {
    if (!this.started) return;
    NfcManager.setEventListener(NfcEvents.StateChanged, null);
    this._cancelRead();
    this.started = false;
  }

  // ── Tag read ────────────────────────────────────────────────

  /**
   * Wait for the operator to tap an NFC tag.
   * Resolves with the tag UID as a normalised hex string (max 16 chars).
   * Also emits 'tagRead' on success and 'tagError' on failure.
   *
   * Rejects with:
   *   NfcNotSupportedError  — device has no NFC
   *   NfcDisabledError      — NFC turned off in settings
   *   NfcReadCancelledError — cancelled via stopListening() or a second call
   *   NfcReadTimeoutError   — no tap within READ_TIMEOUT_MS (30 s)
   *   Error                 — unexpected native error
   */
  async readTag(): Promise<string> {
    if (this.readInProgress) {
      // Cancel the previous read before starting a new one
      await this._cancelRead();
    }

    if (!this.started) {
      throw new NfcNotSupportedError();
    }

    const enabled = await NfcManager.isEnabled();
    if (!enabled) {
      const err = new NfcDisabledError();
      this.emit('nfcDisabled');
      throw err;
    }

    this.readInProgress = true;

    return new Promise<string>((resolve, reject) => {
      // Arm timeout
      this.readTimeoutTimer = setTimeout(() => {
        this.readTimeoutTimer = null;
        const err = new NfcReadTimeoutError();
        this._cancelRead().finally(() => {
          this.emit('tagError', err);
          reject(err);
        });
      }, READ_TIMEOUT_MS);

      // Request technology — suspends until a tag is tapped
      NfcManager.requestTechnology(
        [NfcTech.NfcA, NfcTech.Ndef],
        { invalidateAfterFirstRead: true },
      )
        .then(() => NfcManager.getTag())
        .then((tag: TagEvent | null) => {
          this._clearTimeout();
          const uid = extractUid(tag);
          NfcManager.cancelTechnologyRequest().catch(() => {});
          this.readInProgress = false;
          this.emit('tagRead', uid);
          resolve(uid);
        })
        .catch((err: unknown) => {
          this._clearTimeout();
          NfcManager.cancelTechnologyRequest().catch(() => {});
          this.readInProgress = false;

          const nfcErr = classifyError(err);
          this.emit('tagError', nfcErr);
          reject(nfcErr);
        });
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async _cancelRead(): Promise<void> {
    this._clearTimeout();
    if (this.readInProgress) {
      this.readInProgress = false;
      await NfcManager.cancelTechnologyRequest({ throwOnError: false }).catch(() => {});
    }
  }

  private _clearTimeout(): void {
    if (this.readTimeoutTimer) {
      clearTimeout(this.readTimeoutTimer);
      this.readTimeoutTimer = null;
    }
  }
}

// ── UID extraction ────────────────────────────────────────────

/**
 * Extract and normalise the tag UID from a TagEvent.
 *
 * Android returns id as a colon-separated hex string: "04:AB:CD:EF:01:23:45"
 * We strip colons and lowercase, then truncate to OPERATOR_ID_MAX_LEN.
 *
 * A 4-byte UID  → 8 hex chars  (MIFARE Classic, many NTAG)
 * A 7-byte UID  → 14 hex chars (NTAG213/215/216)
 * A 10-byte UID → 20 hex chars (rare) → truncated to 16
 */
function extractUid(tag: TagEvent | null): string {
  const raw = tag?.id ?? '';
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (!hex) throw new Error('NFC tag returned empty UID');
  return hex.slice(0, OPERATOR_ID_MAX_LEN);
}

/**
 * Map native NFC errors to typed NfcService errors.
 * react-native-nfc-manager surfaces cancellation as a string message
 * containing "cancelled" or "UserCancel".
 */
function classifyError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('cancel') || msg.includes('usercancel') || msg.includes('dismiss')) {
      return new NfcReadCancelledError();
    }
    return err;
  }
  if (typeof err === 'string') {
    const lower = err.toLowerCase();
    if (lower.includes('cancel') || lower.includes('usercancel') || lower.includes('dismiss')) {
      return new NfcReadCancelledError();
    }
    return new Error(err);
  }
  return new Error('Unknown NFC error');
}

// ── Singleton ─────────────────────────────────────────────────

export const nfcService = new NfcService();
