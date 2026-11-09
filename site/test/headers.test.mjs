import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

function block(path) {
  const lines = headers.split(/\n/);
  const start = lines.findIndex((line) => line === path);
  assert.notEqual(start, -1, path);
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] && !lines[i].startsWith(' ') && !lines[i].startsWith('\t') && !lines[i].startsWith('#')) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

test('the site-wide header block adds HSTS, permissions, frame denial, and report-only CSP', () => {
  const site = block('/*');
  assert.match(site, /X-Content-Type-Options: nosniff/);
  assert.match(site, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(site, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.doesNotMatch(site, /preload/);
  assert.match(site, /Permissions-Policy: camera=\(\), geolocation=\(\), payment=\(\), usb=\(\), microphone=\(self\)/);
  assert.match(site, /X-Frame-Options: DENY/);
  assert.match(site, /Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:\/\/challenges\.cloudflare\.com; frame-src https:\/\/challenges\.cloudflare\.com; form-action 'self' https:\/\/app\.kit\.com; base-uri 'self'; frame-ancestors 'none'; object-src 'none'/);
  assert.doesNotMatch(site, /^Content-Security-Policy:/m);
});

test('preview hosts stay noindex and the new headers do not replace that', () => {
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.match(headers, /https:\/\/:version\.:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.doesNotMatch(block('https://:project.pages.dev/*'), /Strict-Transport-Security/);
  assert.doesNotMatch(block('https://:version.:project.pages.dev/*'), /Content-Security-Policy/);
});
