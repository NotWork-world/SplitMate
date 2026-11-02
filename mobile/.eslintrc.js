module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Small one-off layout styles are kept next to the markup they shape.
    'react-native/no-inline-styles': 'off',
  },
  overrides: [
    {
      // The OCR engine reads protobuf-encoded model metadata: bit twiddling is the point.
      files: ['src/ocr/**/*.ts'],
      rules: {
        'no-bitwise': 'off',
        'dot-notation': 'off',
      },
    },
  ],
};
