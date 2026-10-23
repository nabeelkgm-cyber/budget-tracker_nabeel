/** Replaced with the build date and time by scripts/fix-web-build.js, so you can tell which build you are using. */
const RAW = '__BUILD_ID__';
export const BUILD_ID = RAW.startsWith('__') ? 'development' : RAW;
