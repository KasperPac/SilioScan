// ============================================================
// ScannerModule.kt — Native bridge for hardware barcode scanners
// ARCHITECTURE.md §8.1
//
// Registers a BroadcastReceiver for a vendor-configurable intent action.
// When a scan broadcast arrives, extracts the barcode string from common
// intent-extra keys (Zebra DataWedge, Honeywell, Datalogic, generic) and
// emits "onBarcodeScanned" to JS via RCTDeviceEventEmitter.
//
// JS API:
//   NativeModules.ScannerModule.configure(intentAction: string)
// JS events:
//   DeviceEventEmitter.addListener('onBarcodeScanned', (barcode) => ...)
// ============================================================

package com.pacscanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class ScannerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // ── State ─────────────────────────────────────────────────

    private var currentAction: String? = null
    private var receiver: BroadcastReceiver? = null

    // ── Module identity ───────────────────────────────────────

    override fun getName(): String = "ScannerModule"

    // ── JS-callable methods ───────────────────────────────────

    /**
     * Set (or update) the intent action to listen for.
     * Call this from JS with the vendor-specific action string, e.g.:
     *   "com.symbol.datawedge.api.ACTION"      — Zebra DataWedge
     *   "com.honeywell.aidc.action.ACTION_CLAIM_SCANNER" — Honeywell
     *   "com.datalogic.decode.action.DECODE"   — Datalogic
     */
    @ReactMethod
    fun configure(intentAction: String) {
        if (intentAction == currentAction) return
        unregisterReceiver()
        currentAction = intentAction
        registerReceiver(intentAction)
    }

    // Required stubs for RN event emitter (0.65+)
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── BroadcastReceiver lifecycle ───────────────────────────

    private fun registerReceiver(action: String) {
        val filter = IntentFilter(action)
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val barcode = extractBarcode(intent) ?: return
                emitBarcode(barcode)
            }
        }

        // Android 13+ requires explicit exported flag for runtime receivers
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            reactContext.registerReceiver(receiver, filter)
        }
    }

    private fun unregisterReceiver() {
        receiver?.let {
            try {
                reactContext.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Receiver was never registered — safe to ignore
            }
            receiver = null
        }
        currentAction = null
    }

    // ── Barcode extraction ────────────────────────────────────

    /**
     * Try vendor-specific intent-extra keys in priority order.
     * Returns the first non-blank string found, or null.
     */
    private fun extractBarcode(intent: Intent): String? {
        val candidateKeys = listOf(
            "com.symbol.datawedge.data_string",   // Zebra DataWedge
            "com.honeywell.aidc.extra.EXTRA_DECODE_DATA_STRING", // Honeywell
            "decodedData",                          // Generic
            "barcode_string",                       // Datalogic / generic
            "data",                                 // Generic fallback
        )
        return candidateKeys.firstNotNullOfOrNull { key ->
            intent.getStringExtra(key)?.takeIf { it.isNotBlank() }
        }
    }

    // ── Event emission ────────────────────────────────────────

    private fun emitBarcode(barcode: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onBarcodeScanned", barcode)
    }

    // ── Cleanup ───────────────────────────────────────────────

    override fun invalidate() {
        unregisterReceiver()
        super.invalidate()
    }
}
