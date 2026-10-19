/* eslint-env jest */
import 'react-native-gesture-handler/jestSetup';

// Reanimated 4.7's bundled mock initialises native CSS support and throws under Jest,
// so component tests use this minimal stand-in (animations are checked on a device).
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const chain = new Proxy({}, {get: () => () => chain});
  const Animated = {
    View: RN.View,
    Text: RN.Text,
    ScrollView: RN.ScrollView,
    Image: RN.Image,
    createAnimatedComponent: c => c,
  };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: v => ({value: v}),
    useAnimatedStyle: () => ({}),
    withSpring: v => v,
    withTiming: (v, _c, cb) => {
      if (cb) {
        cb(true);
      }
      return v;
    },
    withDelay: (_d, v) => v,
    withSequence: (...a) => a[a.length - 1],
    withRepeat: v => v,
    interpolate: () => 0,
    runOnJS: f => f,
    useEvent: () => () => {},
    useHandler: () => ({context: {}, doDependenciesDiffer: false, useWeb: false}),
    useAnimatedRef: () => ({current: null}),
    useDerivedValue: f => ({value: f()}),
    Easing: {out: x => x, cubic: x => x, bezier: () => x => x},
    FadeInDown: chain,
    FadeOutDown: chain,
  };
});
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async k => (store.has(k) ? store.get(k) : null)),
      setItem: jest.fn(async (k, v) => void store.set(k, v)),
      removeItem: jest.fn(async k => void store.delete(k)),
      clear: jest.fn(async () => store.clear()),
    },
  };
});

jest.mock('react-native-keychain', () => {
  let saved = null;
  return {
    ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x'},
    setGenericPassword: jest.fn(async (u, p) => {
      saved = {username: u, password: p};
      return true;
    }),
    getGenericPassword: jest.fn(async () => saved || false),
    resetGenericPassword: jest.fn(async () => {
      saved = null;
      return true;
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(async () => ({isConnected: true})),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({type: 'cancelled'})),
    signOut: jest.fn(async () => null),
  },
  statusCodes: {},
}));

// Firebase isn't configured in tests: behave like a build without google-services.json.
jest.mock('@react-native-firebase/app', () => ({getApps: () => []}));
jest.mock('@react-native-firebase/messaging', () => ({}));
