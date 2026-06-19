#!/usr/bin/env node
/**
 * Monthly order archive — invoked by Render cron or manually.
 * Requires API_URL (or RENDER_EXTERNAL_URL) and CRON_SECRET.
 */
const https = require('https');
const http = require('http');

const rawBase = (
  process.env.API_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.REACT_APP_API_URL ||
  ''
).replace(/\/$/, '');

const baseUrl = rawBase.startsWith('http') ? rawBase : rawBase ? `https://${rawBase}` : '';

const secret = process.env.CRON_SECRET;
const months = Number(process.env.ARCHIVE_MONTHS || 7);
const execute = process.env.ARCHIVE_EXECUTE === 'true';

if (!baseUrl || !secret) {
  console.error('Missing API_URL (or RENDER_EXTERNAL_URL) and/or CRON_SECRET');
  process.exit(1);
}

const url = new URL(`${baseUrl}/api/admin/maintenance/cron/archive-old`);
const body = JSON.stringify({ months, execute });
const lib = url.protocol === 'https:' ? https : http;

const req = lib.request(
  url,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Cron-Secret': secret,
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      console.log(data);
      process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
    });
  }
);

req.on('error', (err) => {
  console.error('Archive cron request failed:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
