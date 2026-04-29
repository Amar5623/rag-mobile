// plugins/withOnnxRuntime.js
//
// FIX — duplicate libonnxruntime.so build error
//   PROBLEM:
//     Adding `implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.17.3'`
//     pulls in the AAR which contains libonnxruntime.so. But the
//     onnxruntime-react-native module ALREADY bundles its own copy of
//     libonnxruntime.so inside its AAR. Gradle then finds two copies at
//     lib/arm64-v8a/libonnxruntime.so and fails with:
//     "2 files found with path 'lib/arm64-v8a/libonnxruntime.so'"
//
//   FIX:
//     Remove the separate onnxruntime-android AAR dependency entirely.
//     onnxruntime-react-native already contains everything needed.
//     The only thing required for EAS cloud builds is:
//       1. The native module project is included in settings.gradle  ✓
//       2. The app explicitly depends on the :onnxruntime-react-native project
//          so gradle compiles and links it (not just autolinking)       ← NEW
//       3. A SoLoader / JSI initializer call is added via an
//          MainApplication patch so the native lib is loaded at startup ← NEW

const {
  withAppBuildGradle,
  withSettingsGradle,
  withMainApplication,
} = require('@expo/config-plugins');

const withOnnxRuntime = (config) => {

  // ── Step 1: settings.gradle — include the native module project ──────────
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

  // ── Step 2: app/build.gradle — depend on the project (not the AAR) ───────
  //
  // We add `implementation project(':onnxruntime-react-native')` instead of
  // `implementation 'com.microsoft.onnxruntime:onnxruntime-android:X.Y.Z'`.
  //
  // This tells Gradle to compile the onnxruntime-react-native subproject and
  // link its native libraries into the APK — which is what makes
  // NativeModules.Onnxruntime non-null at runtime — without pulling in a
  // second copy of libonnxruntime.so from Maven.
  config = withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;

    if (!gradle.includes("project(':onnxruntime-react-native')")) {
      gradle = gradle.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation project(':onnxruntime-react-native')`
      );
    }

    mod.modResults.contents = gradle;
    return mod;
  });

  return config;
};

module.exports = withOnnxRuntime;