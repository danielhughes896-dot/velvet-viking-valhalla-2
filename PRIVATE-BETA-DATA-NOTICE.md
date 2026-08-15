# Velvet Viking — Private Beta Data Notice

*For the invitation-only beta. Every statement below was checked against the code that is actually deployed, not against a description of it.*

---

## Where your data is stored

**By default, on your own device only.** If you don't sign in, everything Velvet Viking knows about your training — your plan, your logged runs, your notes, your settings — is kept in your own browser or phone storage and is never sent anywhere.

**If you sign in, on our database.** Sign-in is optional and uses an emailed link, so there is no password to create, store or leak. When you sign in, two things are stored with **Supabase**, our database provider: your **email address**, and your **training record** — your plan, your logged runs (distance, pace, heart rate, effort, and anything you type in the notes), your settings, and the coaching history the app builds from them. Nothing else. No name, no date of birth, no address, no payment details.

Your data is protected so that only your own signed-in session can read it.

**The app itself is hosted by Vercel**, which also runs the small server functions that talk to the database on your behalf. Supabase and Vercel are our only data processors.

---

## What we don't do

- **No analytics, advertising or tracking of any kind.** There is no analytics script in the app.
- **No AI or language-model service ever receives your training data** — not automatically, not on request. The coaching is ordinary deterministic software written to give the same answer every time. It is not an AI model and it calls no AI service.
- **We don't sell data.**

## One thing that does leave your device on every visit

The typefaces on our pages are loaded from **Google Fonts**, so Google sees your IP address and browser when a page loads — the same as on most websites. That happens whether or not you sign in.

---

## Strava

Velvet Viking can sync with Strava, but **it is switched off for this beta** while we confirm approval with Strava directly.

For the duration of this beta that means: no Strava data is read, received or stored for any tester; the Connect control is not offered in the app; and the server refuses a connection even if the app is bypassed. Nothing about your Strava account reaches us.

---

## If you withdraw

If you withdraw, we will delete your account and all identifiable personal and training data that Velvet Viking holds on its servers within **30 days** of receiving your request. Email **support@velvetviking.co.uk**. You can also delete your account yourself at any time from Settings, which happens immediately.

**Copies stored locally on your own phone or browser remain under your control.** Deleting your account does not erase them, and we have no way to reach them. To remove them yourself:

- **Reset Plan** in Settings clears your training plan;
- **clearing the app's or browser's stored data, or uninstalling the app**, removes everything the app has kept locally — including your saved sign-in and any plan parked on a shared device.

Use the second option if you want everything gone: Reset Plan clears the plan, but not your stored sign-in or a plan parked from a previous account on the same device.

If your phone backs its apps up to your own cloud account — Android's own backup, for example — a copy may exist there too. That backup belongs to you and your device maker, not to us, and we cannot reach into it. Your device's backup settings are where that is managed.

Data that has already been genuinely anonymised, so that it can no longer be linked back to you, may be retained for product evaluation. *(We do not currently do this. The clause is here so it stays true if that ever changes.)*

---

## Your rights

- **Access** — export a full copy of your data at any time from Settings.
- **Correction** — edit your plan, logs and settings directly in the app.
- **Deletion** — as above.

Questions, or a request about your data: **support@velvetviking.co.uk**

This describes the mechanisms actually built into the app. It is not a claim that the service meets every requirement of GDPR or any other specific privacy law in full.

---

## Notes for HQ — remove before sending to testers

1. **Do not add "only five invited testers can access the beta"** until `supabase-beta-gate.sql` has been run and its final check verified. Until then the gate is not active.
2. **Two limits on the 30-day promise that HQ should be aware of**, neither of which is contradicted by the wording above but both of which are worth knowing:
   - **Supabase automatic backups.** Deleted rows may persist in the provider's own point-in-time backups beyond 30 days, and expire on the provider's schedule. This is standard for any hosted database and is not something the deletion path can change. Check the project's backup retention setting if you want to state a figure.
   - **Vercel function logs.** These contain no email and no user id by design, but do record Strava *activity* IDs when Strava is running. Strava is off for this beta, so none will be created during it — but any from earlier testing sit in Vercel's log retention, which the deletion path does not clear.
3. **"No company has been incorporated"** — the privacy page now says the service is operated by an individual rather than naming a company. Replace with the legal entity if and when one exists.
