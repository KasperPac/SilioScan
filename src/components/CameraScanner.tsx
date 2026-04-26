import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { scannerService } from '../services/ScannerService';

interface Props {
  /** When false the camera preview is paused — use during VALIDATING, BAG_COUNT, etc. */
  active: boolean;
}

export default function CameraScanner({ active }: Props): React.JSX.Element {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const codeScanner = useCodeScanner({
    codeTypes: [
      'code-128', 'code-39', 'code-93',
      'ean-13', 'ean-8', 'itf',
      'qr', 'data-matrix',
    ],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (value) scannerService.reportCameraBarcode(value);
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Camera permission required</Text>
        <Text style={styles.placeholderSub}>Grant camera access in Settings</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>No camera available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        codeScanner={codeScanner}
      />
      {/* Scan frame overlay */}
      <View style={styles.frameOverlay}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Text style={styles.hint}>Align GIN barcode within frame</Text>
      </View>
    </View>
  );
}

const CORNER = 20;
const CORNER_THICK = 3;

const styles = StyleSheet.create({
  container: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginTop: 8,
  },
  placeholder: {
    height: 200,
    borderRadius: 12,
    backgroundColor: '#1e2535',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2e3f5c',
    marginTop: 8,
  },
  placeholderText: {
    color: '#8899bb',
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderSub: {
    color: '#5b6b8a',
    fontSize: 12,
    marginTop: 4,
  },
  frameOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: '75%',
    height: 100,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#4db6ff',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderTopLeftRadius: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderTopRightRadius: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderBottomLeftRadius: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderBottomRightRadius: 3,
  },
  hint: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
});
