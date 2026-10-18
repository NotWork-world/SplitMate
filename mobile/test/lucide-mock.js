// Every Lucide icon renders as an empty View in tests.
const React = require('react');
const {View} = require('react-native');
const Icon = props => React.createElement(View, {testID: props.testID});
module.exports = new Proxy({__esModule: true}, {get: (t, k) => (k in t ? t[k] : Icon)});
