#!/usr/bin/env node
// Claude Code status line command. Reads the status line JSON on stdin,
// prints "Model | 5h 23% | 7d 41%", and saves a snapshot that
// `report.mjs --local` adds to the handoff comment.
// Setup is in tools/handoff-usage/README.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SNAPSHOT } from './report.mjs';
import { snapshotFromStatusline, statuslineText } from './lib.mjs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  // Print something useful even on bad input.
}

const snap = snapshotFromStatusline(payload, Date.now());
if (snap.five_hour || snap.seven_day) {
  const path = process.env.HANDOFF_USAGE_SNAPSHOT || DEFAULT_SNAPSHOT;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(snap));
  } catch {
    // The status line must never fail.
  }
}
console.log(statuslineText(snap));
