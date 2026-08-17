# Release version model

The native shell loads its entire UI from Vercel at launch. So "what version is
this athlete running" is **two facts, not one**, and any model that pretends
otherwise will mislead the first bug report it meets.

This is the smallest model that stays true.

---

## The two numbers

| | What it is | Where it lives | Changes when |
|---|---|---|---|
| **Shell version** | The native container: Capacitor, plugins, manifest, entitlements, signing, icons | `native-version.json` → `shellVersion` | The **native** project changes. Not when the web app changes |
| **Web commit** | The coaching app the shell actually renders | `git rev-parse HEAD` of the Vercel deployment | Every web deploy |

**They are deliberately not the same number.** A shared semantic version would
claim the shell changed every time a coaching copy fix shipped, which is false
and would imply a store release nobody needs.

`versionCode` (Android) is a third value and is neither of the above: it is a
monotonic upload counter, supplied by CI as `github.run_number`. It exists
because Play refuses a `versionCode` it has already seen — and refuses it *after*
the upload.

## Version fields, per platform

| Field | Value | Source |
|---|---|---|
| Android `versionName` | `shellVersion` | `VVV_VERSION_NAME` ← `native-version.json` |
| Android `versionCode` | CI run number | `VVV_VERSION_CODE` ← `github.run_number` |
| iOS `CFBundleShortVersionString` | `shellVersion` | `MARKETING_VERSION` (set in Xcode to match) |
| iOS `CFBundleVersion` | CI run number | `CURRENT_PROJECT_VERSION` |

One file is the source, so the number is never duplicated across build files. A
laptop build with nothing set gets `1` / `1.0` and behaves exactly as before.

## When does the shell need rebuilding?

**When the web app changes: no.** That is the whole point of the remote-runtime
architecture — a coaching fix reaches every installed shell on the next launch
with no store release, no review and no reinstall.

**Rebuild only for:**
- anything under `android/` or `ios/`
- `capacitor.config.json` — especially `server.url`, which repoints **every
  installed shell at once**
- a Capacitor or plugin version bump
- a new permission, entitlement, intent-filter or URL scheme
- the signing key
- **and, if mitigation #1 in `STORE-READINESS.md` is adopted, every web change** —
  bundling the runtime trades remote updatability for offline capability, and
  this row is the cost. It is the reason that decision is HQ's.

## Proving what a tester is running

Every CI artifact carries `PROVENANCE.txt`:

```
shellVersion   : 1.0.0
versionCode    : 42
commit         : <full sha>
ref            : refs/heads/...
workflow run   : <id> (attempt n)
built          : <utc>
remote runtime : https://velvet-viking-valhalla-1.vercel.app
appId          : com.velvetviking.valhalla
```

and filenames are `velvet-viking-<shellVersion>-<versionCode>-<shortSha>.{apk,aab}`
with a `SHA256SUMS.txt`. So a tester can say which file they installed, and the
checksum proves it.

**That still only names the shell half.** The web half is whatever Vercel was
serving at the moment they opened the app. Two ways to close that gap, in
increasing cost:

1. **Ask.** Vercel's deployment for a commit is queryable, and the beta is five
   people over a few weeks. Sufficient for now, and it is what this model
   assumes.
2. **Surface it.** Render the web commit in Settings — a build-time string in the
   runtime. Cheap, one line of copy, and it makes every future bug report
   self-describing. **Recommended before the beta grows past ~20 testers**, not
   before. It is an App change, not a System one, so it is proposed here rather
   than done.

## Release notes

Store release notes describe the **shell**, because that is what the store
distributes:

> **1.0.0** — First store build. Sign-in returns to the app on both platforms;
> training backups save through the system share sheet.

Coaching changes do **not** belong there — they arrive without a release and a
tester who reads about them in store notes will not know which build has them.
They belong in whatever channel tells testers about the product.

## Tagging

`create-release` fires on a pushed tag or a manual dispatch, not on every push.
Tag the **shell**: `shell-v1.0.0`. A tag naming a coaching change would imply an
artifact that does not exist.
