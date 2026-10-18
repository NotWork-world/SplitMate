module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*|@reduxjs|react-redux|immer|reselect|redux|redux-thunk|lucide-react-native|@react-native-google-signin|@react-native-ml-kit|@testing-library)/)',
  ],
  moduleNameMapper: {'^lucide-react-native$': '<rootDir>/test/lucide-mock.js'},
  testPathIgnorePatterns: ['/node_modules/', '/android/'],
};
