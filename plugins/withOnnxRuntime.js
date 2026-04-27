// plugins/withOnnxRuntime.js
const { withAppBuildGradle, withSettingsGradle } = require('@expo/config-plugins');

const withOnnxRuntime = (config) => {
  // 1. Add maven repo + implementation to app/build.gradle
  config = withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;

    // Add maven repo for onnxruntime if not already present
    if (!gradle.includes('onnxruntime-android')) {
      gradle = gradle.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.17.3'`
      );
    }

    mod.modResults.contents = gradle;
    return mod;
  });

  // 2. Include the onnxruntime-react-native native module in settings.gradle
  config = withSettingsGradle(config, (mod) => {
    const settings = mod.modResults.contents;

    if (!settings.includes('onnxruntime-react-native')) {
      mod.modResults.contents =
        settings +
        `
include ':onnxruntime-react-native'
project(':onnxruntime-react-native').projectDir = new File(rootProject.projectDir, '../node_modules/onnxruntime-react-native/android')
`;
    }
    return mod;
  });

  return config;
};

module.exports = withOnnxRuntime;