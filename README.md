# velvet-viking-valhalla-2
Running training

## Strava integration setup

The "Connect Strava" flow uses a serverless function (`api/strava-auth.js`) so
the Strava Client Secret never reaches the browser. For it to work, set these
in the Vercel project's **Settings -> Environment Variables** (Production, and
Preview if you want it working on preview deploys too), then redeploy:

- `STRAVA_CLIENT_ID` — from your app at [strava.com/settings/api](https://www.strava.com/settings/api)
- `STRAVA_CLIENT_SECRET` — from the same page

In that Strava API app's settings, set **Authorization Callback Domain** to
the deployed domain (`velvet-viking-valhalla-1.vercel.app`), with no
`https://` prefix and no path — Strava only lets you register a bare domain.
