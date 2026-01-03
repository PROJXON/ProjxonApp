// Metro configuration for Expo
// We disable package "exports" enforcement to avoid noisy warnings for packages
// that resolve to files not explicitly listed in their exports map (Metro falls back anyway).
//
// This does not change runtime behavior for our app; it only uses Metro's legacy
// resolver path without the warning.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver = config.resolver || {};
config.resolver.unstable_enablePackageExports = false;

module.exports = config;

