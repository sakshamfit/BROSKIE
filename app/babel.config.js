module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // ... other plugins if any
      'react-native-reanimated/plugin',
    ],
  };
};
