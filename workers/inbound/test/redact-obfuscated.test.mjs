import test from 'node:test';
import assert from 'node:assert/strict';
import { redactContact } from '../src/redact.js';

test('redacts spelled-out email addresses', () => {
  assert.equal(redactContact('email name at example dot com please'), 'email [redacted] please');
  assert.equal(redactContact('name [at] example [dot] ca'), '[redacted]');
  assert.equal(redactContact('name (at) mail (dot) example (dot) org'), '[redacted]');
  assert.equal(redactContact('name at example .com'), '[redacted]');
});

test('leaves ordinary sentences alone', () => {
  assert.equal(redactContact('reach me at the hall tomorrow'), 'reach me at the hall tomorrow');
  assert.equal(redactContact('meet at 5 dot 30'), 'meet at 5 dot 30');
});

test('long crafted input finishes quickly', () => {
  const inputs = [
    `a at ${'a'.repeat(5000)}!`,
    `a at ${'a.'.repeat(3000)}!`,
    `a at ${'a dot '.repeat(3000)}!`,
    `a at ${'a '.repeat(5000)}`,
  ];
  for (const input of inputs) {
    const start = Date.now();
    redactContact(input);
    assert.ok(Date.now() - start < 500, `took ${Date.now() - start} ms`);
  }
});
