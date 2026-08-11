// Vercel serverless function — the only place that ever sees the Strava
// Client Secret. It never reaches the browser: this endpoint holds it via
// STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET (set in Vercel Project Settings ->
// Environment Variables) and only ever returns the resulting access/refresh
// tokens to the client, which is the standard confidential-client OAuth
// pattern for a public single-page app with no other backend.
//
//   GET  /api/strava-auth?action=authorize
//     302-redirects the browser straight to Strava's own authorize screen,
//     built server-side so the client never needs to know the Client ID
//     either. redirect_uri is derived from the incoming request's own host,
//     so this works on any deployment (production, preview, custom domain)
//     without hardcoding a URL.
//
//   POST /api/strava-auth   { "code": "..." }
//     Exchanges an OAuth authorization code for tokens
//     (grant_type=authorization_code).
//
//   POST /api/strava-auth   { "refresh_token": "..." }
//     Exchanges a refresh token for a fresh access token
//     (grant_type=refresh_token).

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

function siteOrigin(req){
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}

async function handleAuthorize(req, res, clientId){
  if (!clientId){
    res.status(500).send('Strava is not configured on this server (missing STRAVA_CLIENT_ID).');
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: siteOrigin(req) + '/',
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all'
  });
  res.writeHead(302, { Location: STRAVA_AUTHORIZE_URL + '?' + params.toString() });
  res.end();
}

async function handleTokenRequest(req, res, clientId, clientSecret){
  if (!clientId || !clientSecret){
    res.status(500).json({ error: 'Strava is not configured on this server (missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).' });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string'){
    try{ body = JSON.parse(body); }catch(e){ body = {}; }
  }

  let payload;
  if (body.code){
    payload = { client_id: clientId, client_secret: clientSecret, code: body.code, grant_type: 'authorization_code' };
  } else if (body.refresh_token){
    payload = { client_id: clientId, client_secret: clientSecret, refresh_token: body.refresh_token, grant_type: 'refresh_token' };
  } else {
    res.status(400).json({ error: 'Provide either "code" or "refresh_token" in the request body' });
    return;
  }

  try{
    const stravaResp = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await stravaResp.json();
    if (!stravaResp.ok){
      res.status(stravaResp.status).json({ error: (data && data.message) || 'Strava rejected the request' });
      return;
    }
    // Only ever forward the tokens the client needs -- never the secret, and
    // nothing else Strava might include in the raw response.
    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: data.athlete || null
    });
  }catch(err){
    res.status(502).json({ error: 'Could not reach Strava', message: err.message });
  }
}

module.exports = async function handler(req, res){
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (req.method === 'GET'){
    const action = (req.query && req.query.action) || '';
    if (action === 'authorize'){
      await handleAuthorize(req, res, clientId);
      return;
    }
    res.status(400).json({ error: 'Unknown action. Use ?action=authorize.' });
    return;
  }

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await handleTokenRequest(req, res, clientId, clientSecret);
};
