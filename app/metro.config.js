const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
for (const ext of ['glb', 'gltf', 'bin']) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}

module.exports = config;
