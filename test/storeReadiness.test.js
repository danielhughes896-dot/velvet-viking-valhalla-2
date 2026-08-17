'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

// STORE READINESS -- the native shells, as configuration.
//
// Every assertion here is about a file, not about coaching behaviour, and that
// is the point: this workstream must not be able to touch the product. The one
// runtime fact it does assert is the identity triangle -- the same appId, the
// same auth scheme and the same remote host in the Android manifest, the iOS
// plist, the Capacitor config and the shipped JavaScript. Four places, one
// value, and a mismatch in any of them breaks sign-in on one platform only,
// which is the hardest kind of bug to see.
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

const CAPCFG   = JSON.parse(read('capacitor.config.json'));
const MANIFEST = read('android/app/src/main/AndroidManifest.xml');
const GRADLE   = read('android/app/build.gradle');
const VARS     = read('android/variables.gradle');
const WORKFLOW = read('.github/workflows/build-apk.yml');
const RUNTIME  = read(RUNTIME_RELATIVE);
const IOS_PLIST = exists('ios/App/App/Info.plist') ? read('ios/App/App/Info.plist') : null;

/* Manifest attributes and Gradle statements only. Both files carry long
   explanatory comments, and a rule a comment can satisfy is not a rule. */
const xmlCode = s => s.replace(/<!--[\s\S]*?-->/g, ' ');
const groovyCode = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const APP_ID = 'com.velvetviking.valhalla';

// ---------------------------------------------------------------------------
// 1. ONE IDENTITY, FOUR FILES
// ---------------------------------------------------------------------------
test('1. the application identifier is the same everywhere it appears', () => {
  assert.equal(CAPCFG.appId, APP_ID, 'capacitor.config.json');
  assert.match(groovyCode(GRADLE), new RegExp('applicationId "' + APP_ID.replace(/\./g, '\\.') + '"'),
    'android applicationId');
  assert.match(groovyCode(GRADLE), new RegExp('namespace = "' + APP_ID.replace(/\./g, '\\.') + '"'));
  assert.match(read('android/app/src/main/res/values/strings.xml'),
    new RegExp('<string name="package_name">' + APP_ID.replace(/\./g, '\\.') + '</string>'));
  assert.match(read('assetlinks.json'), new RegExp('"package_name": "' + APP_ID.replace(/\./g, '\\.') + '"'),
    'the App Link declaration names the same package');
  /* Play locks the package name to the app listing on first upload and it can
     never be changed. Every installed beta APK is also keyed to it: changing it
     would strand them as a different app. This test is the tripwire. */
});

test('1. the auth URL scheme is claimed identically on both platforms', () => {
  const scheme = APP_ID;
  assert.match(xmlCode(MANIFEST), new RegExp('android:scheme="' + scheme.replace(/\./g, '\\.') + '"'),
    'Android intent-filter');
  assert.match(read('android/app/src/main/res/values/strings.xml'),
    new RegExp('<string name="custom_url_scheme">' + scheme.replace(/\./g, '\\.') + '</string>'));
  assert.match(RUNTIME, new RegExp("NATIVE_AUTH_REDIRECT = '" + scheme.replace(/\./g, '\\.') + "://auth'"),
    'and the runtime asks Supabase to redirect to exactly that');
  if (IOS_PLIST) {
    assert.match(IOS_PLIST, /<key>CFBundleURLSchemes<\/key>/, 'iOS must claim a scheme at all');
    assert.match(IOS_PLIST, new RegExp('<string>' + scheme.replace(/\./g, '\\.') + '</string>'),
      'iOS CFBundleURLTypes — without this the magic link has nowhere to land and sign-in silently fails');
  }
});

test('1. the remote runtime host is one value, and it is https', () => {
  const url = CAPCFG.server.url;
  assert.match(url, /^https:\/\//, 'the shell must never load its UI over cleartext');
  const host = url.replace(/^https:\/\//, '').replace(/\/.*$/, '');
  assert.match(xmlCode(MANIFEST), new RegExp('android:host="' + host.replace(/\./g, '\\.') + '"'),
    'the App Link intent-filter must name the same host the shell loads');
});

test('1. the App Link path prefix matches what the auth flow actually uses', () => {
  assert.match(xmlCode(MANIFEST), /android:pathPrefix="\/auth"/);
  const routes = JSON.parse(read('vercel.json')).routes || [];
  assert.ok(routes.some(r => r.src === '/auth' || r.src === '/auth/(.*)'),
    'the web deployment must actually serve /auth, or the App Link points at a 404');
});

// ---------------------------------------------------------------------------
// 2. ANDROID RELEASE CONFIGURATION
// ---------------------------------------------------------------------------
test('2. release is signed with the stable key and has no debug fallback', () => {
  const code = groovyCode(GRADLE);
  const rel = code.slice(code.indexOf('release {'));
  assert.match(rel, /signingConfig signingConfigs\.stable/,
    'a release signed with a throwaway debug key can never match assetlinks.json');
  assert.ok(!/signingConfig signingConfigs\.debug/.test(rel));
  assert.match(code, /throw new GradleException/,
    'and a release attempted without the four secrets must fail loudly, not ship');
  ['VVV_KEYSTORE_FILE', 'VVV_KEYSTORE_PASSWORD', 'VVV_KEY_ALIAS', 'VVV_KEY_PASSWORD']
    .forEach(k => assert.ok(code.indexOf(k) !== -1, k + ' must be part of the guard'));
});

test('2. no signing material is in the repository, and cannot be', () => {
  const { execFileSync } = require('child_process');
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(!files.some(f => /\.(keystore|jks|p12|mobileprovision|cer|p8)$/.test(f)),
    'a signing key in the repository is an APK anyone can publish as an update to ours');
  const ig = read('.gitignore');
  ['*.keystore', '*.jks', '*.p12'].forEach(p =>
    assert.ok(ig.split('\n').some(l => l.trim() === p), '.gitignore must cover ' + p));
  assert.ok(!/VVV_KEYSTORE_PASSWORD\s*[:=]\s*['"][^'"$]/.test(GRADLE + WORKFLOW),
    'and no password literal anywhere');
});

test('2. versionCode can advance without editing a build file', () => {
  const code = groovyCode(GRADLE);
  assert.match(code, /versionCode System\.getenv\("VVV_VERSION_CODE"\)/,
    'Play refuses a versionCode it has already seen, so a hardcoded one is uploadable once');
  assert.match(code, /: 1\b/, 'and a local build with nothing set still works');
  assert.match(code, /versionName System\.getenv\("VVV_VERSION_NAME"\) \?: "1\.0"/);
  assert.match(WORKFLOW, /VVV_VERSION_CODE: \$\{\{ github\.run_number \}\}/,
    'CI supplies a monotonic value so nobody has to remember');
});

test('2. targetSdk meets the Play requirement that lands on 31 August 2026', () => {
  /* developer.android.com/google/play/requirements/target-sdk: from 31 August
     2026 new apps and updates must target API 36. Checked against the live
     requirement rather than assumed. */
  const target = /targetSdkVersion = (\d+)/.exec(VARS);
  const compile = /compileSdkVersion = (\d+)/.exec(VARS);
  assert.ok(target && Number(target[1]) >= 36, 'targetSdk must be >= 36, is ' + (target && target[1]));
  assert.ok(compile && Number(compile[1]) >= 36, 'compileSdk must be >= 36');
  const min = /minSdkVersion = (\d+)/.exec(VARS);
  assert.ok(min && Number(min[1]) >= 23, 'minSdk ' + (min && min[1]) + ' is within Capacitor 8 support');
});

test('2. the manifest asks for exactly one permission, and it is INTERNET', () => {
  const perms = Array.from(xmlCode(MANIFEST).matchAll(/uses-permission android:name="([^"]+)"/g))
    .map(m => m[1]);
  assert.deepEqual(perms, ['android.permission.INTERNET'],
    'a permission the product does not use is a Data Safety answer to justify and a reviewer question to answer');
  /* Explicitly absent, and each would be a real declaration burden: location and
     background location (Play requires a video justification), activity
     recognition, body sensors, health, exact alarms, foreground service,
     external storage. The product needs none: pace and distance are typed in or
     imported from Strava server-side, and the file export goes through the
     share sheet rather than to storage. */
  [ 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
    'ACTIVITY_RECOGNITION', 'BODY_SENSORS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM',
    'FOREGROUND_SERVICE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
    'READ_MEDIA_IMAGES', 'POST_NOTIFICATIONS', 'CAMERA', 'RECORD_AUDIO'
  ].forEach(p => assert.ok(MANIFEST.indexOf(p) === -1, 'must not request ' + p));
});

test('2. the auth session cannot leave the device in a cloud backup', () => {
  const code = xmlCode(MANIFEST);
  assert.match(code, /android:allowBackup="false"/,
    'localStorage holds the Supabase refresh token; Auto Backup would copy it to Google Drive');
  assert.match(code, /android:dataExtractionRules="@xml\/data_extraction_rules"/, 'Android 12+');
  assert.match(code, /android:fullBackupContent="@xml\/backup_rules"/, 'Android 11 and below');
  ['android/app/src/main/res/xml/data_extraction_rules.xml',
   'android/app/src/main/res/xml/backup_rules.xml'].forEach(f => {
    assert.ok(exists(f), f + ' must exist or the manifest reference fails the build');
    assert.match(read(f), /<exclude domain="root"/, f + ' must exclude the data directory');
  });
});

test('2. cleartext is not enabled and WebView debugging is not turned on', () => {
  assert.ok(MANIFEST.indexOf('usesCleartextTraffic="true"') === -1,
    'targetSdk 36 defaults cleartext off; nothing may re-enable it');
  assert.ok(MANIFEST.indexOf('android:networkSecurityConfig') === -1,
    'no network security config, so the platform default stands');
  /* Capacitor 8 defaults webContentsDebuggingEnabled to the debuggable flag
     (CapConfig.java: JSONUtils.getBoolean(configJSON, "android.webContentsDebuggingEnabled", isDebug)),
     so a release build has it off already. What must not happen is the config
     overriding that to true, which would make the release inspectable. Left at
     the default rather than pinned to false, so the beta APK stays debuggable. */
  const android = CAPCFG.android || {};
  assert.notEqual(android.webContentsDebuggingEnabled, true,
    'an inspectable release WebView exposes the athlete’s session to anything with adb');
  assert.notEqual(android.allowMixedContent, true);
});

test('2. the launcher has the icons and the label a store listing needs', () => {
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(d => {
    assert.ok(exists('android/app/src/main/res/mipmap-' + d + '/ic_launcher.png'), d + ' launcher');
    assert.ok(exists('android/app/src/main/res/mipmap-' + d + '/ic_launcher_round.png'), d + ' round');
  });
  assert.ok(exists('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
    'adaptive icon, required for Android 8+ launchers');
  assert.match(read('android/app/src/main/res/values/strings.xml'),
    /<string name="app_name">Velvet Viking<\/string>/);
  assert.ok(exists('android/app/src/main/res/drawable/splash.png'), 'splash');
});

// ---------------------------------------------------------------------------
// 3. CI PRODUCES WHAT PLAY ACTUALLY TAKES
// ---------------------------------------------------------------------------
test('3. the Play upload artifact is an AAB, and it is built', () => {
  assert.match(WORKFLOW, /gradlew bundleRelease/,
    'Play requires an Android App Bundle for new apps; an APK cannot be uploaded');
  assert.match(WORKFLOW, /release-dist\/\*\.aab/, 'and it must be uploaded as an artifact');
});

test('3. every artifact is named for its shell version and its commit', () => {
  assert.match(WORKFLOW, /velvet-viking-\$\{\{ steps\.shellver\.outputs\.name \}\}-\$\{VVV_VERSION_CODE\}-\$SHORT/,
    'app-debug.apk answers no question a bug report asks');
  assert.match(WORKFLOW, /sha256sum/, 'checksums, so a tester can prove which file they installed');
  assert.match(WORKFLOW, /PROVENANCE\.txt/);
});

test('3. provenance records both halves of what a tester is running', () => {
  const prov = WORKFLOW.slice(WORKFLOW.indexOf('PROVENANCE.txt <<EOF'));
  ['shellVersion', 'versionCode', 'commit', 'remote runtime', 'appId']
    .forEach(k => assert.ok(prov.indexOf(k) !== -1, 'provenance must record ' + k));
  /* The shell loads its UI from Vercel, so "which version" is two facts. Without
     the remote runtime URL beside the shell version, a bug report names half of
     what was running. */
});

test('3. iOS is validated on every push, and the external gate is stated', () => {
  assert.match(WORKFLOW, /validate-ios:/, 'a job that can run without a Mac');
  assert.match(WORKFLOW, /npx cap sync ios/);
  assert.match(WORKFLOW, /node test\/tools\/validate-ios\.js/);
  assert.ok(exists('test/tools/validate-ios.js'));
  assert.match(WORKFLOW, /requires macOS/,
    'and it must say what it cannot do rather than appear to have done it');
});

test('3. no secret is written into a repository file', () => {
  const secretRefs = Array.from(WORKFLOW.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)).map(m => m[1]);
  assert.ok(secretRefs.length >= 4, 'signing secrets are referenced, not embedded');
  assert.ok(!/-----BEGIN|sb_secret_|MII[A-Za-z0-9+/]{40,}/.test(WORKFLOW),
    'and no key material is inlined');
});

// ---------------------------------------------------------------------------
// 4. iOS CONFIGURATION
// ---------------------------------------------------------------------------
test('4. the iOS project exists and carries the required privacy manifest', () => {
  assert.ok(exists('ios/App/App.xcodeproj/project.pbxproj'), 'Xcode project');
  assert.ok(exists('ios/App/App/PrivacyInfo.xcprivacy'),
    'App Store Connect rejects an upload that uses @capacitor/filesystem without one');
  const pm = read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(pm, /NSPrivacyAccessedAPICategoryFileTimestamp/);
  assert.match(pm, /C617\.1/, 'the reason code Apple defines for container file timestamps');
  assert.match(pm, /<key>NSPrivacyTracking<\/key>\s*<false\/>/,
    'the product has no advertising identifier and no analytics SDK, so it says so');
});

test('4. the plugins the app actually uses are the plugins declared', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys(pkg.dependencies || {});
  ['@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/app',
   '@capacitor/filesystem', '@capacitor/share'].forEach(d =>
    assert.ok(deps.indexOf(d) !== -1, d + ' must be a declared dependency'));
  // and each is genuinely reached from the runtime
  assert.match(RUNTIME, /nativePlugin\('Filesystem'\)/);
  assert.match(RUNTIME, /nativePlugin\('Share'\)/);
  assert.match(RUNTIME, /nativeAppPlugin\(\)/);
});

test('4. iOS requests no permission the product does not use', () => {
  if (!IOS_PLIST) return;
  ['NSLocationWhenInUseUsageDescription', 'NSHealthShareUsageDescription',
   'NSMotionUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription',
   'NSPhotoLibraryUsageDescription', 'NSBluetoothAlwaysUsageDescription',
   'NSUserTrackingUsageDescription']
    .forEach(k => assert.ok(IOS_PLIST.indexOf(k) === -1,
      k + ' would be a prompt for something the product never does'));
  assert.ok(IOS_PLIST.indexOf('NSAllowsArbitraryLoads') === -1,
    'App Transport Security must not be weakened');
});

test('4. universal links are scaffolded without a fabricated Team ID', () => {
  assert.ok(exists('apple-app-site-association.json.template'),
    'the file is designed and not served, because a cached invalid AASA is worse than none');
  const aasa = read('apple-app-site-association.json.template');
  JSON.parse(aasa);   // must stay valid JSON so activation is a rename
  assert.match(aasa, /APPLE_TEAM_ID/, 'the Team ID is an explicit external requirement');
  assert.ok(!/\b[A-Z0-9]{10}\.com\.velvetviking/.test(aasa.replace(/APPLE_TEAM_ID/g, 'X')),
    'and no plausible-looking Team ID is invented anywhere');
  assert.match(aasa, /"\/auth"/, 'it claims /auth only, matching the Android pathPrefix');
  assert.ok(exists('ios/App/App/App.entitlements.template'));

  const routes = JSON.parse(read('vercel.json')).routes || [];
  assert.ok(!routes.some(r => /apple-app-site-association/.test(r.src || '')),
    'and it is deliberately NOT routed yet');
});

// ---------------------------------------------------------------------------
// 5. THE WEB PRODUCT IS UNTOUCHED
// ---------------------------------------------------------------------------
test('5. no Serverless Function was added', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => /\.js$/.test(f) && f.charAt(0) !== '_');
  assert.equal(fns.length, 12, 'the Hobby limit is 12 and there is no headroom');
});

test('5. the private-beta flags and gates are exactly as they were', () => {
  const access = read('api/_access.js');
  assert.match(access, /function accountRequired\(\)\{ return flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\); \}/);
  assert.match(access, /function commercialRequired\(\)\{ return flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\); \}/);
  assert.match(read('supabase-commercial-activation.sql'), /select 'no'::text/, 'commercial migration still off');
  assert.match(read('supabase-beta-hardening.sql'), /select 'no'::text/, 'beta hardening still off');
  assert.match(read('supabase-beta-gate.sql'), /create trigger beta_allowlist_gate/, 'allowlisting retained');
});

test('5. the web route table is unchanged by this workstream', () => {
  const routes = JSON.parse(read('vercel.json')).routes || [];
  const fsAt = routes.findIndex(r => r.handle === 'filesystem');
  assert.equal(fsAt, routes.length - 1, 'the filesystem handler is still last');
  assert.equal(routes[0].src, '/', 'and the gate is still first');
  assert.ok(routes.some(r => r.src === '/\\.well-known/assetlinks\\.json'),
    'the Android App Link file is still served');
});

test('5. the shell loads the production runtime and nothing else', () => {
  assert.equal(CAPCFG.server.url, 'https://velvet-viking-valhalla-1.vercel.app',
    'changing this repoints every installed shell at once — it is not a build detail');
  assert.equal(CAPCFG.webDir, 'www', 'the bundled fallback directory is unchanged');
});
