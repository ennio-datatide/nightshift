import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { takeLock } from '../dist/store.js';

test('a second run waits while the first holds the lock, and runs once it is released', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ns-lock-'));
  const release = await takeLock(dir, 'a');
  assert.ok(release);
  assert.equal(await takeLock(dir, 'a'), undefined);
  await release();
  const again = await takeLock(dir, 'a');
  assert.ok(again);
  await again();
});

test('a lock with our own pid that we did not take (left before a container restart, where the daemon is pid 1 again) is cleared', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ns-lock-'));
  await writeFile(path.join(dir, 'a.lock'), String(process.pid));
  const release = await takeLock(dir, 'a');
  assert.ok(release);
  assert.equal((await readFile(path.join(dir, 'a.lock'), 'utf8')).trim(), String(process.pid));
  await release();
});

test('a lock held by a process that is gone is cleared', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ns-lock-'));
  await writeFile(path.join(dir, 'a.lock'), '999999');
  const release = await takeLock(dir, 'a');
  assert.ok(release);
  await release();
});
