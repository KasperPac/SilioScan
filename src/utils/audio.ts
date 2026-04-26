// audio.ts — success/fail sounds + vibration feedback (Phase 3)
import { Vibration } from 'react-native';

export function vibrateSuccess(): void {
  Vibration.vibrate(100);
}

export function vibrateFail(): void {
  Vibration.vibrate([0, 200, 100, 200]);
}

export function vibrateSignoff(): void {
  Vibration.vibrate([0, 100, 50, 100, 50, 300]);
}
