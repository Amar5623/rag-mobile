// plugins/withModelAssets.js
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withModelAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'models'
      );

      const modelSrc = path.join(projectRoot, 'assets', 'models', 'bge-small.onnx');
      const vocabSrc = path.join(projectRoot, 'assets', 'models', 'vocab.txt');

      fs.mkdirSync(destDir, { recursive: true });

      if (fs.existsSync(modelSrc)) {
        fs.copyFileSync(modelSrc, path.join(destDir, 'bge-small.onnx'));
        console.log('[withModelAssets] ✅ Copied bge-small.onnx to native assets');
      } else {
        console.warn('[withModelAssets] ⚠️ bge-small.onnx not found at', modelSrc);
      }

      if (fs.existsSync(vocabSrc)) {
        fs.copyFileSync(vocabSrc, path.join(destDir, 'vocab.txt'));
        console.log('[withModelAssets] ✅ Copied vocab.txt to native assets');
      } else {
        console.warn('[withModelAssets] ⚠️ vocab.txt not found at', vocabSrc);
      }

      return cfg;
    },
  ]);
};