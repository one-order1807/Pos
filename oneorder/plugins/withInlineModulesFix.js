// Expo's Android autolinking plugin runs `expo-modules-autolinking mirror-kotlin-inline-modules
// --watched-directories-serialized <value>` and falls back to an EMPTY LIST when the Gradle
// property below is missing. Gradle drops empty lists from a command line, so the option ends up
// with no value and the whole build fails with "Process 'command 'node'' finished with non-zero
// exit value 1". Defining the property as an empty JSON array avoids that.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'expo.inlineModules.watchedDirectories';

module.exports = function withInlineModulesFix(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === KEY));
    cfg.modResults.push({ type: 'property', key: KEY, value: '[]' });
    return cfg;
  });
};
