import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAgent, findAgent } from '../dist/loader.js';

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
    prompt: 'Say hello.',
    file: path.join(dir, 'hello.md'),
  });
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
