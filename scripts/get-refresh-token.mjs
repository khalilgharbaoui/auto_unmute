#!/usr/bin/env node
/**
 * One-shot OAuth helper to obtain a Chrome Web Store API refresh token.
 *
 * Usage:
 *   CLIENT_ID=xxx CLIENT_SECRET=yyy node scripts/get-refresh-token.mjs
 *
 * The script:
 *   1. Spins up a tiny localhost server on http://127.0.0.1:8976
 *   2. Opens your browser to Google's consent screen
 *   3. Captures the authorization code on the redirect
 *   4. Exchanges it for a refresh token and prints it
 *
 * The refresh token is long-lived. Store it as the CWS_REFRESH_TOKEN GitHub
 * secret. Do NOT commit it.
 */

import http from 'node:http';
import { exec } from 'node:child_process';
import { URL } from 'node:url';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT = 'http://127.0.0.1:8976/callback';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CLIENT_ID and CLIENT_SECRET env vars first.');
  console.error('Example:');
  console.error('  CLIENT_ID=xxx.apps.googleusercontent.com CLIENT_SECRET=GOCSPX-... node scripts/get-refresh-token.mjs');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No code in callback.');
    return;
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenResp.json();
    if (!tok.refresh_token) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(
        `No refresh_token returned. Response:\n${JSON.stringify(tok, null, 2)}\n\n` +
        `Tip: revoke the app at https://myaccount.google.com/permissions and try again.`
      );
      console.error('No refresh_token. Full response:', tok);
      process.exit(1);
    }

    res.writeHead(200, { 'content-type': 'text/html' }).end(
      '<h1>OK — refresh token captured.</h1>' +
      '<p>You can close this tab and return to the terminal.</p>'
    );

    console.log('\n========================================================');
    console.log('SUCCESS — copy this into the GitHub secret CWS_REFRESH_TOKEN:');
    console.log('========================================================\n');
    console.log(tok.refresh_token);
    console.log('\n========================================================\n');
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500).end(`Error: ${e}`);
    console.error(e);
    process.exit(1);
  }
});

server.listen(8976, '127.0.0.1', () => {
  console.log('Opening browser to:', authUrl.toString());
  console.log('\nIf the browser does not open, paste that URL manually.\n');
  const opener = process.platform === 'darwin' ? 'open' :
                 process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${opener} "${authUrl.toString()}"`, () => {});
});
