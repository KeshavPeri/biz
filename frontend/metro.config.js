const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// react-native-svg-transformer — lets us import local .svg files as RN
// components (so our pre-approved icon set inherits `currentColor`). The
// `/expo` transformer entrypoint is the SDK-managed one. Move `svg` out of
// assetExts (bundled as a file) and into sourceExts (compiled to a component).
config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer/expo',
);
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = withNativeWind(config, { input: './global.css' });
