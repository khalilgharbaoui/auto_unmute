#!/usr/bin/env node
/**
 * Create a brand-new Chrome Web Store item via the raw API.
 *
 * Usage:
 *   CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
 *     node scripts/create-cws-item.mjs path/to/extension.zip
 *
 * Prints the new item's extension ID. Use that ID as CWS_EXTENSION_ID
 * in the GitHub secrets and from then on use chrome-webstore-upload-cli
 * to upload subsequent versions.
 */

import fs from 'node:fs';

const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = process.env;
const zipPath = process.argv[2];

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !zipPath) {
  console.error('Usage:');
  console.error('  CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \\');
  console.error('    node scripts/create-cws-item.mjs path/to/extension.zip');
  process.exit(1);
}

if (!fs.existsSync(zipPath)) {
  console.error(`ZIP not found: ${zipPath}`);
  process.exit(1);
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const json = await r.json();
  if (!r.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function createItem(accessToken, zip) {
  const r = await fetch('https://www.googleapis.com/upload/chromewebstore/v1.1/items', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-goog-api-version': '2',
      'content-type': 'application/zip',
    },
    body: zip,
  });
  const json = await r.json();
  if (!r.ok || json.uploadState !== 'SUCCESS') {
    throw new Error(`Create failed: ${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

(async () => {
  console.log('Getting access token…');
  const token = await getAccessToken();

  console.log(`Uploading ${zipPath} to create new item…`);
  const zip = fs.readFileSync(zipPath);
  const result = await createItem(token, zip);

  console.log('\n========================================================');
  console.log('SUCCESS — new item created.');
  console.log('========================================================');
  console.log(`Extension ID: ${result.id}`);
  console.log('========================================================\n');
  console.log('Next steps:');
  console.log(`  1. Add this as the GitHub secret CWS_EXTENSION_ID:`);
  console.log(`     gh secret set CWS_EXTENSION_ID --body "${result.id}"`);
  console.log(`  2. Open the dashboard to fill the listing form once:`);
  console.log(`     https://chrome.google.com/webstore/devconsole/${result.id}/edit`);
  console.log(`  3. Submit for review (button in dashboard, or via the workflow).`);
  console.log('\nFull API response:');
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
