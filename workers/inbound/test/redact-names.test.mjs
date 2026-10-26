import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiNamePass,
  parseNamePass,
  redactOutsideD1,
} from '../src/redact.js';

test('emails, phones, and personal names are removed before text leaves D1', async () => {
  const input = 'Jordan Blake asked to list a Burns Supper. Email jordan.blake@example.com or call 403-555-0148.';
  const redacted = await redactOutsideD1(input);
  assert.match(redacted, /Burns Supper/);
  assert.doesNotMatch(redacted, /Jordan Blake/);
  assert.doesNotMatch(redacted, /jordan\.blake@example\.com/);
  assert.doesNotMatch(redacted, /403-555-0148/);
  assert.match(redacted, /\[redacted\]/);

  const introduced = await redactOutsideD1('My name is Riley Quinn and the hall is Community Hall.');
  assert.doesNotMatch(introduced, /Riley Quinn/);
  assert.match(introduced, /Community Hall/);
});

test('a failed name pass replaces the whole value', async () => {
  const failed = await redactOutsideD1('Listing for Friday only.', {
    namePass: async () => { throw new Error('name pass failed'); },
  });
  assert.equal(failed, '[redacted]');

  const badShape = await redactOutsideD1('Listing for Friday only.', {
    namePass: async () => ({ names: 'Riley Quinn' }),
  });
  assert.equal(badShape, '[redacted]');

  const added = await redactOutsideD1('Please list the supper for Riley Quinn.', {
    namePass: async () => ({ names: ['Riley Quinn'] }),
  });
  assert.doesNotMatch(added, /Riley Quinn/);
  assert.match(added, /\[redacted\]/);
  assert.match(added, /supper/i);
});

test('the Workers AI name pass fails closed on FAIL or a bad payload', async () => {
  await assert.rejects(
    () => aiNamePass('Jordan Blake', async () => ({ response: 'FAIL' }), '@cf/meta/llama-3.1-8b-instruct'),
    (err) => err.code === 'name_pass_failed',
  );
  assert.deepEqual(parseNamePass({ response: '{"names":["Riley Quinn"]}' }), { names: ['Riley Quinn'] });
  const calls = [];
  const found = await aiNamePass('note', async (model, payload) => {
    calls.push({ model, payload });
    return { response: { names: [] } };
  }, '@cf/meta/llama-3.1-8b-instruct');
  assert.deepEqual(found, { names: [] });
  assert.equal(calls[0].model, '@cf/meta/llama-3.1-8b-instruct');
  assert.match(calls[0].payload.messages[1].content, /<untrusted>/);
});
