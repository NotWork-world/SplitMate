const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// shared/fixtures lives outside the app folder; Metro must be allowed to watch it.
const config = {
  watchFolders: [path.resolve(__dirname, '..', 'shared')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
