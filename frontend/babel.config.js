module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],

    // NOTE: gluestack-ui's init added a babel module-resolver aliasing `@` -> `./`,
    // which broke our existing `@/*` -> `./src/*` imports. Metro already resolves
    // our tsconfig `paths` (both `@/* -> ./src/*` and `@/assets/* -> ./assets/*`),
    // so we drop module-resolver entirely and keep only the worklets plugin.
    plugins: ['react-native-worklets/plugin'],
  };
};
