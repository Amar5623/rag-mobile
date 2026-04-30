const {
  withAppBuildGradle,
  withSettingsGradle,
} = require('@expo/config-plugins');

const withOnnxRuntime = (config) => {

  config = withSettingsGradle(config, (mod) => {
    const settings = mod.modResults.contents;
    console.log('[withOnnxRuntime] settings.gradle has onnxruntime?', settings.includes('onnxruntime-react-native'));
    if (!settings.includes('onnxruntime-react-native')) {
      mod.modResults.contents =
        settings +
        `\ninclude ':onnxruntime-react-native'\nproject(':onnxruntime-react-native').projectDir = new File(rootProject.projectDir, '../node_modules/onnxruntime-react-native/android')\n`;
      console.log('[withOnnxRuntime] ✅ Added onnxruntime-react-native to settings.gradle');
    } else {
      console.log('[withOnnxRuntime] ℹ️ settings.gradle already has onnxruntime-react-native (autolinking)');
    }
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    console.log('[withOnnxRuntime] build.gradle has onnxruntime project dep?', gradle.includes("project(':onnxruntime-react-native')"));

    if (!gradle.includes("project(':onnxruntime-react-native')")) {
      // More robust replacement — find the dependencies block
      if (gradle.includes('dependencies {')) {
        gradle = gradle.replace(
          'dependencies {',
          `dependencies {\n    implementation project(':onnxruntime-react-native')`
        );
        console.log('[withOnnxRuntime] ✅ Added implementation project to app/build.gradle');
      } else {
        console.error('[withOnnxRuntime] ❌ Could not find dependencies { in app/build.gradle');
      }
    } else {
      console.log('[withOnnxRuntime] ℹ️ build.gradle already has onnxruntime dep');
    }

    mod.modResults.contents = gradle;
    return mod;
  });

  return config;
};

module.exports = withOnnxRuntime;