import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAgent, findAgent, loadFolder } from '../dist/loader.js';

async function agentsDir(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nightshift-agents-'));
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  return dir;
}

test('loads frontmatter settings and the prompt below them', async () => {
  const dir = await agentsDir({
    'hello.md': '---\nname: hello\ndescription: Says hello\ncwd: work\nmodel: haiku\nmaxTurns: 1\n---\n\nSay hello.\n',
  });
  const agent = await loadAgent(path.join(dir, 'hello.md'));
  assert.deepEqual(agent, {
    name: 'hello',
    description: 'Says hello',
    cwd: path.join(dir, 'work'),
    model: 'haiku',
    maxTurns: 1,
    secrets: [],
    read: [],
    run: [],
    tools: [],
    disallowedTools: [],
    untrusted: false,
    billing: 'subscription',
    prompt: 'Say hello.',
    file: path.join(dir, 'hello.md'),
  });
});

test('loads the privilege settings', async () => {
  const dir = await agentsDir({
    'p.md': [
      '---',
      'name: p',
      'description: P',
      'secrets: [MAIL_KEY]',
      'read: [docs, /work/social]',
      'run: ["npm run -s decide:*"]',
      'tools: [Edit]',
      'disallowedTools: [Write]',
      'untrusted: true',
      'billing: api',
      '---',
      'Do p.',
    ].join('\n'),
  });
  const agent = await loadAgent(path.join(dir, 'p.md'));
  assert.deepEqual(agent.secrets, ['MAIL_KEY']);
  assert.deepEqual(agent.read, ['docs', '/work/social']);
  assert.deepEqual(agent.run, ['npm run -s decide:*']);
  assert.deepEqual(agent.tools, ['Edit']);
  assert.deepEqual(agent.disallowedTools, ['Write']);
  assert.equal(agent.untrusted, true);
  assert.equal(agent.billing, 'api');
});

test('privilege settings of the wrong type are rejected', async () => {
  const dir = await agentsDir({
    'list.md': '---\nname: l\ndescription: x\nsecrets: MAIL_KEY\n---\nDo it.',
    'flag.md': '---\nname: f\ndescription: x\nuntrusted: yes please\n---\nDo it.',
    'bill.md': '---\nname: b\ndescription: x\nbilling: credit\n---\nDo it.',
  });
  await assert.rejects(loadAgent(path.join(dir, 'list.md')), /list\.md: secrets must be a list of names/);
  await assert.rejects(loadAgent(path.join(dir, 'flag.md')), /flag\.md: untrusted must be true or false/);
  await assert.rejects(loadAgent(path.join(dir, 'bill.md')), /bill\.md: billing must be subscription or api/);
});

test('cwd defaults to the folder of the agent file, absolute cwd is kept', async () => {
  const dir = await agentsDir({
    'a.md': '---\nname: a\ndescription: A\n---\nDo a.',
    'b.md': '---\nname: b\ndescription: B\ncwd: /tmp\n---\nDo b.',
  });
  assert.equal((await loadAgent(path.join(dir, 'a.md'))).cwd, dir);
  assert.equal((await loadAgent(path.join(dir, 'b.md'))).cwd, '/tmp');
});

test('a file without frontmatter, name or prompt is rejected with the file in the message', async () => {
  const dir = await agentsDir({
    'none.md': 'Just text.',
    'noname.md': '---\ndescription: x\n---\nDo it.',
    'empty.md': '---\nname: empty\ndescription: x\n---\n\n',
    'turns.md': '---\nname: turns\ndescription: x\nmaxTurns: lots\n---\nDo it.',
  });
  await assert.rejects(loadAgent(path.join(dir, 'none.md')), /none\.md: missing frontmatter/);
  await assert.rejects(loadAgent(path.join(dir, 'noname.md')), /noname\.md: name is required/);
  await assert.rejects(loadAgent(path.join(dir, 'empty.md')), /empty\.md: the prompt below the frontmatter is empty/);
  await assert.rejects(loadAgent(path.join(dir, 'turns.md')), /turns\.md: maxTurns must be a positive whole number/);
});

test('findAgent finds an agent by name in a folder', async () => {
  const dir = await agentsDir({ 'x.md': '---\nname: greeter\ndescription: G\n---\nGreet.' });
  await mkdir(path.join(dir, 'sub'));
  assert.equal((await findAgent(dir, 'greeter')).name, 'greeter');
  await assert.rejects(findAgent(dir, 'missing'), /no agent named "missing"/);
});

const ok = (name, extra = '') => `---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nDo ${name}.\n`;

async function errorsOf(text) {
  const dir = await agentsDir({ 'a.md': text });
  const [result] = await loadFolder(dir);
  return result.errors;
}

test('loads every setting of the spec', async () => {
  const dir = await agentsDir({
    'helper.md': ok('helper'),
    'full.md': [
      '---',
      'name: daily-summary',
      'description: Sends the daily summary',
      'schedule: "0 7 * * *"',
      'timezone: Europe/Madrid',
      'gate: npm run -s has-news',
      'permissionMode: dontAsk',
      'effort: high',
      'maxBudgetUsd: 0.5',
      'timeoutMinutes: 10',
      'skills: [voice-espanol]',
      'skillsDir: skills',
      'mcpServers: { files: { command: npx, args: [files] } }',
      'subagents: [helper]',
      'review: { tools: ["Bash(npm run -s reply:*)"], instructions: Reject rude replies. }',
      'deliver: { type: email, to: OWNER_EMAIL, from: news@example.com }',
      'quietWhen: NOTHING TO REPORT',
      '---',
      'Summarise the day.',
    ].join('\n'),
  });
  const results = await loadFolder(dir);
  assert.deepEqual(results.map((r) => r.errors), [[], []]);
  const agent = results.find((r) => r.name === 'daily-summary').agent;
  assert.equal(agent.schedule, '0 7 * * *');
  assert.equal(agent.timezone, 'Europe/Madrid');
  assert.equal(agent.gate, 'npm run -s has-news');
  assert.equal(agent.permissionMode, 'dontAsk');
  assert.equal(agent.effort, 'high');
  assert.equal(agent.maxBudgetUsd, 0.5);
  assert.equal(agent.timeoutMinutes, 10);
  assert.deepEqual(agent.skills, ['voice-espanol']);
  assert.equal(agent.skillsDir, 'skills');
  assert.deepEqual(agent.mcpServers, { files: { command: 'npx', args: ['files'] } });
  assert.deepEqual(agent.subagents, ['helper']);
  assert.deepEqual(agent.review, { tools: ['Bash(npm run -s reply:*)'], instructions: 'Reject rude replies.' });
  assert.deepEqual(agent.deliver, { type: 'email', to: 'OWNER_EMAIL', from: 'news@example.com' });
  assert.equal(agent.quietWhen, 'NOTHING TO REPORT');
});

test('each kind of mistake has its own message', async () => {
  assert.deepEqual(await errorsOf('---\ndescription: x\n---\nDo it.'), [
    'name is required (lowercase letters, digits and dashes, such as daily-summary)',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'schedule: "61 * * * *"\n')), [
    'schedule must be a cron expression such as "0 7 * * *", got "61 * * * *" (CronPattern: Invalid value for minute: 61)',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'scheduel: "0 7 * * *"\n')), [
    'unknown setting "scheduel"; the settings are name, description, schedule, timezone, cwd, gate, secrets, read, run, ' +
      'tools, disallowedTools, permissionMode, model, effort, maxTurns, maxBudgetUsd, timeoutMinutes, skills, skillsDir, ' +
      'mcpServers, subagents, untrusted, review, deliver, quietWhen, billing',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'maxBudgetUsd: lots\n')), ['maxBudgetUsd must be a positive number, got "lots"']);
  assert.deepEqual(await errorsOf(ok('a', 'timezone: Mars/Olympus\n')), [
    'timezone must be an IANA time zone such as Europe/Madrid, got "Mars/Olympus"',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'subagents: [ghost]\n')), [
    'subagents names "ghost", but no other agent file in this folder has that name',
  ]);
});

test('every mistake in a file is reported, each with the file', async () => {
  const dir = await agentsDir({
    'bad.md': '---\nname: Bad Name\ndescription: x\neffort: huge\npermissionMode: yolo\nsecrets: [mail-key]\nuntrusted: 1\n---\n',
  });
  const errors = (await loadFolder(dir))[0].errors;
  assert.deepEqual(errors, [
    'name must be lowercase letters, digits and dashes, such as daily-summary, got "Bad Name"',
    'secrets must be a list of names (letters, digits and underscores, such as MAIL_KEY), got ["mail-key"]',
    'permissionMode must be one of default, acceptEdits, bypassPermissions, plan, dontAsk, auto, got "yolo"',
    'effort must be one of low, medium, high, xhigh, max, got "huge"',
    'untrusted must be true or false, got 1',
    'the prompt below the frontmatter is empty',
  ]);
  await assert.rejects(loadAgent(path.join(dir, 'bad.md')), (err) => {
    assert.ok(err.message.startsWith(`${path.join(dir, 'bad.md')}: name must be`));
    assert.equal(err.message.split('\n').length, 6);
    return true;
  });
});

test('review, deliver and mcpServers are checked field by field', async () => {
  assert.deepEqual(await errorsOf(ok('a', 'review: { tools: Bash, instructions: [x], when: always }\n')), [
    'review.tools must be a list of tool patterns, got "Bash"',
    'review.instructions must be text, got ["x"]',
    'unknown setting "review.when"; review takes tools, instructions',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'deliver: slack\n')), [
    'deliver must be email, command, log or an object with a type, got "slack"',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'deliver: { type: command }\n')), [
    'deliver.command must be a command that receives the text on stdin, got nothing',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'deliver: { type: email, to: 5, cc: me }\n')), [
    'deliver.to must be a secret name or an address, got 5',
    'unknown setting "deliver.cc"; email delivery takes type, to, from',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'mcpServers: [files]\n')), [
    'mcpServers must be an object of server configs by name, got ["files"]',
  ]);
  assert.deepEqual(await errorsOf(ok('a', 'deliver: log\nmcpServers: { files: npx }\n')), [
    'mcpServers.files must be a server config (an object), got "npx"',
  ]);
});

test('two files with the same name are both reported', async () => {
  const dir = await agentsDir({ 'one.md': ok('same'), 'two.md': ok('same') });
  const [one, two] = await loadFolder(dir);
  assert.deepEqual(one.errors, ['name "same" is also used by two.md']);
  assert.deepEqual(two.errors, ['name "same" is also used by one.md']);
});

test('findAgent ignores broken files of other agents', async () => {
  const dir = await agentsDir({ 'a.md': ok('good'), 'b.md': ok('broken', 'scheduel: x\n') });
  assert.equal((await findAgent(dir, 'good')).name, 'good');
  await assert.rejects(findAgent(dir, 'broken'), /b\.md: unknown setting "scheduel"/);
});

test('findAgent fails when a subagent it names is broken', async () => {
  const dir = await agentsDir({ 'a.md': ok('boss', 'subagents: [helper]\n'), 'b.md': ok('helper', 'effort: huge\n') });
  await assert.rejects(findAgent(dir, 'boss'), /boss uses subagent helper, which is broken:\n.*b\.md: effort must be one of/);
});
