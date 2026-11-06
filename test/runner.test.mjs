import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAgent } from '../dist/loader.js';
import { runAgent } from '../dist/runner.js';

async function setup(frontmatter, prompt = 'Say hello.') {
  const dir = await mkdtemp(path.join(tmpdir(), 'nightshift-run-'));
  const file = path.join(dir, 'hello.md');
  await writeFile(file, `---\n${frontmatter}\n---\n${prompt}\n`);
  return { agent: await loadAgent(file), state: path.join(dir, 'state'), dir };
}

// Stands in for the SDK's query: records what it was given and yields the messages a session would.
function fakeQuery(messages) {
  const calls = [];
  const query = (params) => {
    calls.push(params);
    return (async function* () { yield* messages; })();
  };
  return { query, calls };
}

const success = { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0.0123, result: 'Hello from Nightshift.' };

async function records(state, name) {
  const text = await readFile(path.join(state, `${name}.jsonl`), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('passes the prompt, cwd, model and maxTurns to query and records the run', async () => {
  const { agent, state, dir } = await setup('name: hello\ndescription: Says hello\ncwd: .\nmodel: haiku\nmaxTurns: 1');
  const { query, calls } = fakeQuery([{ type: 'system', subtype: 'init' }, success]);

  const record = await runAgent(agent, { query, stateDir: state });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'Say hello.');
  assert.equal(calls[0].options.cwd, dir);
  assert.equal(calls[0].options.model, 'haiku');
  assert.equal(calls[0].options.maxTurns, 1);

  const [written] = await records(state, 'hello');
  assert.deepEqual(written, record);
  assert.equal(written.agent, 'hello');
  assert.equal(written.status, 'success');
  assert.equal(written.turns, 1);
  assert.equal(written.costUsd, 0.0123);
  assert.equal(written.result, 'Hello from Nightshift.');
  assert.ok(Date.parse(written.start) <= Date.parse(written.end));
});

test('leaves model and maxTurns out when the file does not set them', async () => {
  const { agent, state } = await setup('name: hello\ndescription: Says hello');
  const { query, calls } = fakeQuery([success]);
  await runAgent(agent, { query, stateDir: state });
  assert.ok(!('model' in calls[0].options));
  assert.ok(!('maxTurns' in calls[0].options));
});

test('records an SDK error result with its subtype as the status', async () => {
  const { agent, state } = await setup('name: hello\ndescription: Says hello\nmaxTurns: 1');
  const { query } = fakeQuery([{ type: 'result', subtype: 'error_max_turns', num_turns: 1, total_cost_usd: 0.01, errors: ['hit the turn limit'] }]);
  const record = await runAgent(agent, { query, stateDir: state });
  assert.equal(record.status, 'error_max_turns');
  assert.equal(record.result, 'hit the turn limit');
});

test('appends one record per run, and records a crash as an error', async () => {
  const { agent, state } = await setup('name: hello\ndescription: Says hello');
  await runAgent(agent, { query: fakeQuery([success]).query, stateDir: state });
  const crashing = () => (async function* () { throw new Error('Claude Code not found'); })();
  const record = await runAgent(agent, { query: crashing, stateDir: state });

  assert.equal(record.status, 'error');
  assert.equal(record.result, 'Claude Code not found');
  const all = await records(state, 'hello');
  assert.deepEqual(all.map((r) => r.status), ['success', 'error']);
});
