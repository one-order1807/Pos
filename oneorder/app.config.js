// Dynamic layer on top of app.json's static defaults - the only thing that differs between the
// two Android build variants (admin vs. waiter) is name/package/icon label, selected by the
// APP_VARIANT env var set in CI (see .github/workflows/build-apk.yml) before `expo prebuild` runs.
// Everything else (version, plugins, permissions, EAS project, update URL) is shared - these are
// still fundamentally the same app/project, just two different native wrappers around the same JS.
//
// Runtime code reads which variant it's running as via `Constants.expoConfig.extra.appVariant`
// (see App.tsx) - that value gets baked into each APK's embedded manifest at prebuild time, so the
// admin build and the waiter build each know what they are without any other wiring.
const base = require('./app.json').expo;

const isWaiter = process.env.APP_VARIANT === 'waiter';

module.exports = {
  expo: {
    ...base,
    name: isWaiter ? 'ONE-ORDER W' : base.name,
    android: {
      ...base.android,
      // The admin package id is kept exactly as it's always been - changing it would orphan any
      // already-installed device's local data (Android treats a different package id as a wholly
      // separate app). Only the new waiter variant gets its own, so both can be installed side by
      // side on the same phone/tablet without colliding.
      package: isWaiter ? 'com.oneorder.pos.waiter' : base.android.package,
    },
    ios: {
      ...base.ios,
      bundleIdentifier: isWaiter ? 'com.oneorder.pos.waiter' : base.ios.bundleIdentifier,
    },
    extra: {
      ...base.extra,
      appVariant: isWaiter ? 'waiter' : 'admin',
      // Each variant checks for its own updates against its own channel file/APK, so a waiter
      // build's "check for update" link can never point at the admin build's .apk (see
      // src/update/check.ts and the matrixed "Publish the update-check manifest" CI job).
      updateChannel: isWaiter ? 'waiter' : base.extra.updateChannel,
    },
  },
};
