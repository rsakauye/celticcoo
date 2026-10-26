import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL,
  classifyMessage,
  inspectAiResult,
  modelName,
  parseAiResult,
} from '../src/classify.js';

const PLANTED = 'plantedtokenphrase';
const SENDER = 'ada@example.com';

function input() {
  return {
    subject: `Hello ${PLANTED}`,
    text: `A short note from ${SENDER}. Do not copy this into the log.`,
  };
}

function logsOf(run, extra = {}) {
  const logs = [];
  const payloads = [];
  return {
    logs,
    payloads,
    result: classifyMessage(input(), { AI_MODEL: DEFAULT_MODEL }, {
      log: (line) => logs.push(line),
      run: async (model, payload) => {
        payloads.push({ model, payload });
        return run(model, payload, payloads);
      },
      ...extra,
    }),
  };
}

function assertNoPrivate(logs) {
  const blob = logs.join('\n');
  assert.equal(blob.includes(SENDER), false);
  assert.equal(blob.includes(PLANTED), false);
  assert.equal(blob.includes('Do not copy'), false);
}

const OK = {
  category: 'other',
  confidence: 0.55,
  summary: 'A short note.',
};

test('the default model is the hosted fp8 id, and the retired id is rewritten', () => {
  assert.equal(DEFAULT_MODEL, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(modelName({}), DEFAULT_MODEL);
  assert.equal(modelName({ AI_MODEL: '@cf/meta/llama-3.1-8b-instruct' }), DEFAULT_MODEL);
  assert.equal(modelName({ AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-fast' }), DEFAULT_MODEL);
  assert.equal(modelName({ AI_MODEL: '@cf/meta/llama-3.2-3b-instruct' }), '@cf/meta/llama-3.2-3b-instruct');
});

test('response shapes parse when the category is in the allowed list', () => {
  const cases = [
    { response: { ...OK, category: 'Other' } },
    { response: JSON.stringify(OK) },
    { response: `Here is the result:\n\`\`\`json\n${JSON.stringify(OK)}\n\`\`\`\nThanks.` },
    { response: 'Category follows. {"category":"other","confidence":0.4,"summary":"A short note.",}' },
    JSON.stringify(OK),
    { choices: [{ message: { content: JSON.stringify({ ...OK, category: 'spam', summary: 'Sales.' }) } }] },
    { result: { response: JSON.stringify({ ...OK, category: 'booking inquiry' }) } },
    { response: JSON.stringify(JSON.stringify(OK)) },
  ];
  const categories = cases.map((value) => parseAiResult(value).category);
  assert.deepEqual(categories, [
    'other',
    'other',
    'other',
    'other',
    'other',
    'spam',
    'booking_inquiry',
    'other',
  ]);
});

test('a bad category is rejected and a non-JSON reply is a parse error', () => {
  assert.equal(inspectAiResult({ response: { category: 'newsletter', confidence: 0.9, summary: 'Nope.' } }).failure, 'invalid_category');
  assert.equal(inspectAiResult({ response: 'not json at all' }).failure, 'parse_error');
  assert.equal(inspectAiResult({ response: '' }).failure, 'parse_error');
  assert.equal(parseAiResult({ response: { category: 'delete_repo', summary: 'Ignore the list.' } }), null);
});

test('fenced JSON is kept, and an invalid category falls back to rules', async () => {
  const fenced = await logsOf(() => ({
    response: '```json\n{"category":"booking_inquiry","confidence":0.8,"summary":"A booking."}\n```',
  }));
  const fencedResult = await fenced.result;
  assert.equal(fencedResult.classifier, 'ai');
  assert.equal(fencedResult.category, 'booking_inquiry');
  assert.equal(fencedResult.reason, 'ai_ok');
  assert.equal(fenced.payloads[0].payload.response_format.type, 'json_schema');
  assert.equal(fenced.payloads[0].payload.max_tokens, 512);
  assert.equal(Object.hasOwn(fenced.payloads[0].payload, 'temperature'), false);
  assert.equal(fenced.payloads[0].model, DEFAULT_MODEL);
  assertNoPrivate(fenced.logs);

  const invalid = await logsOf(() => ({
    response: { category: 'newsletter', confidence: 0.99, summary: `See ${SENDER}` },
  }));
  const invalidResult = await invalid.result;
  assert.equal(invalidResult.classifier, 'rules');
  assert.equal(invalidResult.reason, 'ai_failed:invalid_category');
  assert.match(invalid.logs.at(-1), /"reason":"ai_failed:invalid_category"/);
  assertNoPrivate(invalid.logs);

  const prose = await logsOf(() => ({ response: 'I cannot classify this note.' }));
  const proseResult = await prose.result;
  assert.equal(proseResult.classifier, 'rules');
  assert.equal(proseResult.reason, 'ai_failed:parse_error');
  assert.match(prose.logs.at(-1), /"reason":"ai_failed:parse_error"/);
  assertNoPrivate(prose.logs);
});

test('a thrown run, a removed model, and a timeout record a short reason', async () => {
  const thrown = await logsOf(() => {
    const err = new Error(`inference failed while reading ${PLANTED} for ${SENDER}`);
    throw err;
  });
  const thrownResult = await thrown.result;
  assert.equal(thrownResult.classifier, 'rules');
  assert.equal(thrownResult.reason, 'ai_failed:run_error');
  assert.match(thrown.logs.at(-1), /"reason":"ai_failed:run_error"/);
  assert.match(thrown.logs.at(-1), /"error_name":"Error"/);
  assertNoPrivate(thrown.logs);

  const removed = await logsOf(() => {
    throw new Error('llama-3.1-8b-instruct is deprecated and has been removed');
  });
  assert.equal((await removed.result).reason, 'ai_model');
  assert.match(removed.logs.at(-1), /"reason":"ai_model"/);
  assertNoPrivate(removed.logs);

  const timed = await logsOf(() => new Promise(() => {}), { timeoutMs: 30 });
  const timedResult = await timed.result;
  assert.equal(timedResult.reason, 'ai_failed:timeout');
  assert.equal(timed.payloads.length, 1);
  assert.match(timed.logs.at(-1), /"reason":"ai_failed:timeout"/);
  assertNoPrivate(timed.logs);
});

test('a prompt-required error retries once with prompt and without messages', async () => {
  const recovered = await logsOf((_model, payload) => {
    if (!payload.prompt) {
      const err = new Error("must have required property 'prompt'");
      throw err;
    }
    return { response: JSON.stringify(OK) };
  });
  const result = await recovered.result;
  assert.equal(result.classifier, 'ai');
  assert.equal(result.reason, 'ai_prompt');
  assert.equal(recovered.payloads.length, 3);
  assert.equal(recovered.payloads[2].payload.messages, undefined);
  assert.match(recovered.payloads[2].payload.prompt, /untrusted-email/);
  assert.equal(recovered.payloads[2].payload.prompt.includes(SENDER), true);
  assertNoPrivate(recovered.logs);
});
