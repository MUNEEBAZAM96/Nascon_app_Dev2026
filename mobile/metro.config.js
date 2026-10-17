const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// macOS writes "._*" AppleDouble files on non-APFS drives; Expo Router would treat them as routes.
const appleDouble = /(^|[\\/])\._[^\\/]*$/;
const existing = config.resolver.blockList;
config.resolver.blockList = existing
  ? [].concat(existing, appleDouble)
  : appleDouble;

module.exports = config;
