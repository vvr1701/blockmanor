// The drag's UI-thread gesture math (§7.3, §4.5 v1.8) needs the worklets babel
// plugin to compile `'worklet'`-directive functions at all — but do NOT list it
// here. `babel-preset-expo` adds `react-native-worklets/plugin` itself whenever
// Reanimated 4 / standalone worklets are installed (see its configs/expo.js,
// `worklets` option, default true). Naming it again applies the transform twice.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
