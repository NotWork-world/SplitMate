import {useEffect, useState} from 'react';
import {Keyboard} from 'react-native';

/**
 * Height of the on-screen keyboard (0 when hidden). Android 15+ draws apps
 * edge-to-edge, so the window is no longer resized for the keyboard; screens
 * and sheets use this to keep their footer buttons visible.
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}
