'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/* THE ANDROID RELEASE PATH, PINNED
 * ===========================================================================
 * The .aab that reaches Google Play is built by CI and by nothing else -- this
 * environment cannot build Android at all (no SDK, and the egress policy
 * returns 403 from dl.google.com), so the workflow IS the release process
 * rather than a convenience wrapper around a local one.
 *
 * That makes a handful of its properties load-bearing, and none of them are
 * visible in a green run: a workflow that skipped the tests, or that signed
 * with a throwaway key, or that leaked a keystore password into a log, would
 * look exactly like a workflow that did none of those things. So they are
 * asserted here.
 *
 * Checked against the workflow TEXT rather than a parsed object on purpose:
 * this repository has no test dependencies, and adding a YAML parser to assert
 * on YAML would be a worse trade than matching the handful of lines that
 * matter.
 */

const ROOT = path.join(__dirname, '..');
const WF_PATH = path.join(ROOT, '.github', 'workflows', 'build-apk.yml');
const WF = fs.readFileSync(WF_PATH, 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const at = needle => WF.indexOf(needle);

test('there is exactly one Android release workflow', () => {
  /* A second one would mean two ways to produce an artifact somebody uploads,
     signed by whatever each happened to configure. */
  const dir = path.join(ROOT, '.github', 'workflows');
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.deepEqual(files, ['build-apk.yml'],
    'a second workflow appeared -- the release path must not be duplicated: ' + files.join(', '));
});

test('the complete suite runs BEFORE anything is built', () => {
  /* A red suite must never produce a signed artifact. Ordering is the whole
     assertion: a test step after the build proves nothing about the build. */
  const tests = at('run: npm test');
  assert.ok(tests > 0, 'the workflow never runs the test suite');
  ['assembleDebug', 'bundleRelease', 'assembleRelease'].forEach(task => {
    const t = at('./gradlew ' + task);
    assert.ok(t > tests, 'the suite runs after ' + task + ' -- it must gate the build');
  });
});

test('it builds a bundle, and uploads it or fails loudly', () => {
  assert.match(WF, /\.\/gradlew bundleRelease/, 'no .aab is produced');
  assert.match(WF, /bundle\/release\/\*\.aab/, 'the .aab is never uploaded');
  assert.match(WF, /if-no-files-found: error/,
    'a missing artifact would pass silently');
});

test('the release build is fail-closed without signing configuration', () => {
  /* The release buildType has no debug fallback (see build.gradle), so an
     unsigned release is not a thing that can be produced -- but the workflow
     must SKIP rather than attempt and fail, so an owner who has not added the
     secrets yet still gets a green debug signal. */
  const guarded = WF.match(/if: \$\{\{ env\.ANDROID_KEYSTORE_BASE64 != '' \}\}/g) || [];
  assert.ok(guarded.length >= 3,
    'the release steps are not all guarded on the signing secret');
  assert.match(WF, /ANDROID_KEYSTORE_BASE64 == ''/, 'nothing explains a skipped release');
  assert.match(GRADLE, /signingConfig signingConfigs\.stable/,
    'the release buildType no longer demands the stable key');
  assert.match(GRADLE, /throw new GradleException/,
    'the build no longer fails outright on a missing release key');
});

test('the workflow reads exactly the signing inputs the build actually uses', () => {
  /* The two naming systems are easy to confuse and cost real time in the
     GitHub UI: the SECRETS are ANDROID_*, and the environment variables Gradle
     reads are VVV_*. The workflow is the mapping between them, so both halves
     are pinned to what the other side really wants. */
  /* De-duplicated: build.gradle reads VVV_KEYSTORE_FILE more than once (the
     debug buildType tests for it before the release config uses it). */
  const gradleReads = [...new Set([...GRADLE.matchAll(/System\.getenv\("([A-Z_]+)"\)/g)]
    .map(m => m[1]).filter(n => /KEYSTORE|KEY_/.test(n)))].sort();
  assert.deepEqual(gradleReads,
    ['VVV_KEYSTORE_FILE', 'VVV_KEYSTORE_PASSWORD', 'VVV_KEY_ALIAS', 'VVV_KEY_PASSWORD'].sort(),
    'build.gradle reads different signing variables than expected');
  gradleReads.forEach(n => assert.ok(WF.indexOf(n + ':') !== -1,
    'the workflow never supplies ' + n));

  const secrets = [...new Set([...WF.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]))].sort();
  assert.deepEqual(secrets,
    ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].sort(),
    'the set of GitHub secrets changed -- the owner instructions must change with it');
});

test('no secret is ever printed, and the keystore never touches the repository', () => {
  /* The keystore is reconstructed into the runner's temp directory and exists
     only for the life of the job. Echoing any of the four would put it in a log
     that outlives the run. */
  assert.match(WF, /\$RUNNER_TEMP/, 'the keystore is written somewhere other than the runner temp');
  /* THE LEAK IS AN INTERPOLATED VALUE, NOT A NAME. The workflow deliberately
     names all four secrets in a ::notice:: telling the owner which ones are
     missing, which is help rather than disclosure -- so what is forbidden is
     echoing a ${{ secrets.* }} expansion, not mentioning the word. */
  const echoedSecret = /echo[^\n]*\$\{\{\s*secrets\./.test(WF);
  assert.equal(echoedSecret, false, 'a secret VALUE is echoed into the log');
  /* Nor may one be handed to a step that prints its inputs. */
  assert.ok(!/run:[^\n]*\$\{\{\s*secrets\.[A-Z_]*PASSWORD/.test(WF),
    'a password is interpolated directly into a run command');
  /* base64 -d writes the key to a file; it must never be printed to stdout. */
  assert.ok(!/base64 -d[^>]*$/m.test(WF), 'the decoded keystore is not redirected to a file');
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /keystore|\.jks/i, 'a keystore is not gitignored');
  const tracked = fs.readdirSync(ROOT).filter(f => /\.(jks|keystore|p12)$/i.test(f));
  assert.deepEqual(tracked, [], 'a keystore is sitting in the repository: ' + tracked.join(', '));
});

test('nothing publishes to Google Play', () => {
  /* The founder uploads by hand. A publish step would make a CI run change the
     store, which is not a thing that should be one merge away. */
  [/upload-google-play/i, /r0adkll/i, /play-console/i, /androidpublisher/i,
   /service_account/i, /serviceAccountJson/i].forEach(rx =>
    assert.ok(!rx.test(WF), 'a Google Play publish step appeared: ' + rx));
});

test('the toolchain matches what this project actually requires', () => {
  /* Both of these were established by real CI failures, and the comments in
     the workflow record them: the Capacitor 8 CLI refuses Node < 22, and
     @capacitor/android 8 compiles at Java 21 so JDK 17 cannot build it. */
  assert.match(WF, /node-version: '22'/, 'Capacitor 8 CLI requires Node >= 22');
  assert.match(WF, /java-version: '21'/, '@capacitor/android 8 needs JDK 21');
  assert.match(WF, /android-actions\/setup-android/, 'no Android SDK is installed');
  assert.match(WF, /npx cap sync android/, 'the native project is never synced');
});

test('a run builds one identified commit, not a moving branch', () => {
  assert.match(WF, /ref: \$\{\{ github\.event\.inputs\.ref \|\| github\.sha \}\}/,
    'the checkout does not pin an exact commit');
  assert.match(WF, /inputs:\s*\n\s*ref:/, 'a manual run cannot name a commit');
});

test('the run says what it built', () => {
  /* A version code can never be reused on Play, so which artifact came from
     which commit has to be readable after the fact. */
  ['applicationId', 'versionCode', 'versionName', 'github.sha']
    .forEach(k => assert.ok(WF.indexOf(k) !== -1, 'the summary omits ' + k));
  assert.match(WF, /GITHUB_STEP_SUMMARY/, 'the identity is not reported anywhere visible');
  assert.match(WF, /no \.aab was produced/, 'a missing bundle is not caught before upload');
});

test('the identity reported is read from the build, not hardcoded', () => {
  const summary = WF.slice(at('Report build identity'), at('Upload SIGNED RELEASE BUILD'));
  assert.match(summary, /android\/app\/build\.gradle/,
    'the summary hardcodes values instead of reading the gradle file');
  assert.ok(!/com\.velvetviking\.valhalla/.test(summary),
    'the application id is hardcoded in the summary and can drift');
});

test('the application id is unchanged', () => {
  assert.match(GRADLE, /applicationId "com\.velvetviking\.valhalla"/);
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.appId, 'com.velvetviking.valhalla');
});
