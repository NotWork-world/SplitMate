import {Vibration} from 'react-native';

// Subtle, short pulses; Android only needs the VIBRATE permission (declared in the manifest).
export const haptics = {
  tap: () => Vibration.vibrate(8),
  success: () => Vibration.vibrate([0, 12, 60, 18]),
  warning: () => Vibration.vibrate([0, 30]),
};
