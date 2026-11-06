import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAgent } from '../dist/runner.js';
import { startScheduler } from '../dist/scheduler.js';
import { appendRun, readRuns } from '../dist/store.js';

// A clock the test moves by hand: timers fire in order as it passes their time, never on their own.
function fakeClock(start) {
  let now = Date.parse(start);
  const timers = new Set();
  return {
    now: () => new Date(now),
    setTimer: (fn, ms) => {
      const timer = { at: now + Math.max(0, ms), fn };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => { timers.delete(timer); },
    advanceTo(time) {
      const end = Date.parse(time);
      for (;;) {
        const due = [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.delete(due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
  };
}

async function folder() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nightshift-schedule-'));
  await mkdir(path.join(dir, 'agents'));
  return { dir, agents: path.join(dir, 'agents'), state: path.join(dir, 'state') };
}

function agentFile(name, frontmatter) {
  return `---\nname: ${name}\ndescription: ${name}\n${frontmatter}\n---\nDo ${name}.\n`;
}

const record = (agent, start, extra = {}) => ({
  agent, start, end: start, status: 'success', turns: 1, costUsd: 0.01, result: 'done', reviews: [], delivered: 'log', ...extra,
});

// Starts a scheduler whose run function only notes when each agent was started.
async function schedule(f, start, opts = {}) {
  const clock = fakeClock(start);
  const calls = [];
  const lines = [];
  const run = opts.run ?? (async (agent) => {
    calls.push({ name: agent.name, at: clock.now().toISOString() });
    return record(agent.name, clock.now().toISOString());
  });
  const scheduler = await startScheduler({ agentsDir: f.agents, stateDir: f.state, run, clock, log: (l) => lines.push(l), keepDays: opts.keepDays });
  return { clock, calls, lines, scheduler };
}

const MADRID_8 = 'schedule: "0 8 * * *"\ntimezone: Europe/Madrid';

test('08:00 Europe/Madrid fires at 07:00 UTC in winter and 06:00 UTC in summer', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', MADRID_8));
  for (const [start, before, at] of [
    ['2026-01-15T00:00:00Z', '2026-01-15T06:59:59Z', '2026-01-15T07:00:00.000Z'],
    ['2026-07-15T00:00:00Z', '2026-07-15T05:59:59Z', '2026-07-15T06:00:00.000Z'],
  ]) {
    const { clock, calls, scheduler } = await schedule(f, start);
    clock.advanceTo(before);
    assert.deepEqual(calls, []);
    clock.advanceTo(at);
    assert.deepEqual(calls, [{ name: 'daily', at }]);
    await scheduler.stop();
  }
});

test('across the October clock change, 08:00 Madrid moves from 06:00 to 07:00 UTC', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', MADRID_8));
  const { clock, calls, scheduler, lines } = await schedule(f, '2026-10-24T00:00:00Z');
  assert.match(lines[0], /^2026-10-24T00:00:00.000Z scheduled daily: 0 8 \* \* \* \(Europe\/Madrid\), next 2026-10-24 08:00$/);
  clock.advanceTo('2026-10-26T00:00:00Z');
  assert.deepEqual(calls.map((c) => c.at), ['2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z']);
  await scheduler.stop();
});

test('without a timezone the schedule is read in the process time zone', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'local.md'), agentFile('local', 'schedule: "30 9 * * *"'));
  const { clock, calls, scheduler } = await schedule(f, '2026-01-15T00:00:00Z');
  clock.advanceTo('2026-01-16T00:00:00Z');
  const expected = new Date(2026, 0, 15, 9, 30).toISOString();
  assert.deepEqual(calls.map((c) => c.at), [expected]);
  await scheduler.stop();
});

test('agents without a schedule are never started by the daemon', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'manual.md'), agentFile('manual', ''));
  const { clock, calls, scheduler, lines } = await schedule(f, '2026-01-15T00:00:00Z');
  clock.advanceTo('2026-01-17T00:00:00Z');
  assert.deepEqual(calls, []);
  assert.ok(!lines.some((l) => l.includes('manual')));
  await scheduler.stop();
});

// Catch-up

test('a run missed by less than an hour runs once on start, and a restart does not run it again', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', MADRID_8));
  await appendRun(f.state, record('daily', '2026-01-14T07:00:02.000Z'));

  const first = await schedule(f, '2026-01-15T07:40:00Z');
  await first.scheduler.idle();
  assert.deepEqual(first.calls, [{ name: 'daily', at: '2026-01-15T07:40:00.000Z' }]);
  assert.ok(first.lines.some((l) => l.endsWith('started daily (catching up 2026-01-15 08:00, 40 min late)')));
  await first.scheduler.stop();

  // The fake run wrote no record, so only the daemon state can tell the run already started.
  const second = await schedule(f, '2026-01-15T07:50:00Z');
  await second.scheduler.idle();
  assert.deepEqual(second.calls, []);
  await second.scheduler.stop();
});

test('a run missed by more than an hour is recorded as missed, without running or delivering, once', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', `${MADRID_8}\ndeliver: { type: command, command: "touch delivered" }`));
  await appendRun(f.state, record('daily', '2026-01-14T07:00:02.000Z'));

  const first = await schedule(f, '2026-01-15T09:30:00Z');
  await first.scheduler.idle();
  assert.deepEqual(first.calls, []);
  const runs = await readRuns(f.state, 'daily');
  assert.equal(runs.length, 2);
  assert.deepEqual({ ...runs[1], result: undefined }, {
    agent: 'daily', start: '2026-01-15T07:00:00.000Z', end: '2026-01-15T09:30:00.000Z', status: 'missed',
    turns: null, costUsd: null, result: undefined, reviews: [], delivered: 'log',
  });
  assert.equal(runs[1].result, 'the daemon was not running at 2026-01-15 08:00 (2 h 30 min late)');
  assert.ok(first.lines.some((l) => l.endsWith('missed daily: the daemon was not running at 2026-01-15 08:00 (2 h 30 min late)')));
  await first.scheduler.stop();

  const second = await schedule(f, '2026-01-15T09:40:00Z');
  await second.scheduler.idle();
  assert.equal((await readRuns(f.state, 'daily')).length, 2);
  await second.scheduler.stop();
});

test('nothing is caught up when the last run is after the previous scheduled time, or the agent never ran', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', MADRID_8));
  await writeFile(path.join(f.agents, 'fresh.md'), agentFile('fresh', MADRID_8));
  await appendRun(f.state, record('daily', '2026-01-15T07:00:01.000Z'));
  const { calls, scheduler } = await schedule(f, '2026-01-15T07:30:00Z');
  await scheduler.idle();
  assert.deepEqual(calls, []);
  assert.deepEqual(await readRuns(f.state, 'fresh'), []);
  await scheduler.stop();
});

// One run at a time

test('a fire while the previous run is still going is refused by the lock and recorded as skipped', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'slow.md'), agentFile('slow', 'schedule: "* * * * *"'));
  let finish;
  const hold = new Promise((resolve) => { finish = resolve; });
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const query = () => (async function* () {
    started();
    await hold;
    yield { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0.01, result: 'slow done' };
  })();
  const runs = [];
  const run = (agent) => {
    const p = runAgent(agent, { query, stateDir: f.state });
    runs.push(p);
    return p;
  };
  const { clock, scheduler, lines } = await schedule(f, '2026-01-15T07:00:30Z', { run });
  clock.advanceTo('2026-01-15T07:01:00Z');
  await running;
  clock.advanceTo('2026-01-15T07:02:00Z');
  const second = await runs[1];
  assert.equal(second.status, 'skipped');
  assert.equal(second.result, 'already running');
  finish();
  await scheduler.idle();
  const statuses = (await readRuns(f.state, 'slow')).map((r) => r.status);
  assert.deepEqual(statuses, ['skipped', 'success']);
  assert.ok(lines.some((l) => l.endsWith('skipped slow: already running')));
  assert.ok(lines.some((l) => /finished slow: success, 1 turn, \$0.0100, delivered log$/.test(l)));
  await scheduler.stop();
});

// Hot reload

test('added, changed, removed and broken files update their jobs on the next rescan; other agents are unaffected', async () => {
  const f = await folder();
  const file = (name) => path.join(f.agents, `${name}.md`);
  await writeFile(file('a'), agentFile('a', 'schedule: "0 * * * *"\ntimezone: UTC'));
  const { clock, calls, lines, scheduler } = await schedule(f, '2026-01-15T00:00:30Z');
  const fired = (from) => calls.filter((c) => c.at >= from).map((c) => `${c.name} ${c.at.slice(11, 16)}`);

  // Added and changed.
  await writeFile(file('b'), agentFile('b', 'schedule: "30 * * * *"\ntimezone: UTC'));
  await writeFile(file('a'), agentFile('a', 'schedule: "15 * * * *"\ntimezone: UTC'));
  clock.advanceTo('2026-01-15T00:01:30Z');
  await scheduler.idle();
  assert.ok(lines.some((l) => l.endsWith('scheduled b: 30 * * * * (UTC), next 2026-01-15 00:30')));
  assert.ok(lines.some((l) => l.endsWith('reloaded a: 15 * * * * (UTC), next 2026-01-15 00:15')));
  clock.advanceTo('2026-01-15T01:00:30Z');
  assert.deepEqual(fired('2026-01-15T00:00'), ['a 00:15', 'b 00:30']);

  // Removed and broken: their jobs go; a keeps running.
  await rm(file('b'));
  await writeFile(file('c'), agentFile('c', 'schedule: "45 * * * *"\ntimezone: Mars/Olympus'));
  await writeFile(file('a'), agentFile('a', 'schedule: "every day"'));
  clock.advanceTo('2026-01-15T01:01:30Z');
  await scheduler.idle();
  assert.ok(lines.some((l) => l.endsWith('removed b: its file is gone')));
  const broken = lines.filter((l) => l.includes('file error'));
  assert.equal(broken.length, 2);
  assert.match(broken.find((l) => l.includes('c.md')), /file error .*c\.md: .*timezone/);
  assert.ok(lines.some((l) => l.endsWith('removed a: its file has errors, until it is fixed')));
  // A broken file is logged once, not on every rescan.
  clock.advanceTo('2026-01-15T01:10:30Z');
  await scheduler.idle();
  assert.equal(lines.filter((l) => l.includes('file error')).length, 2);
  clock.advanceTo('2026-01-15T02:00:30Z');
  assert.deepEqual(fired('2026-01-15T01:00:31'), []);

  // Fixed.
  await writeFile(file('a'), agentFile('a', 'schedule: "15 * * * *"\ntimezone: UTC'));
  await writeFile(file('c'), agentFile('c', 'schedule: "45 * * * *"\ntimezone: UTC'));
  clock.advanceTo('2026-01-15T02:01:30Z');
  await scheduler.idle();
  clock.advanceTo('2026-01-15T03:00:30Z');
  assert.deepEqual(fired('2026-01-15T02:00:31'), ['a 02:15', 'c 02:45']);
  await scheduler.stop();
});

test('a change to the folder is picked up through the watcher without waiting for the rescan', async () => {
  const f = await folder();
  const { clock, lines, scheduler } = await schedule(f, '2026-01-15T00:00:30Z');
  await writeFile(path.join(f.agents, 'w.md'), agentFile('w', 'schedule: "0 * * * *"\ntimezone: UTC'));
  // The watcher's event arrives on its own; then the debounce passes on the fake clock.
  for (let i = 0; i < 300 && !lines.some((l) => l.includes('scheduled w')); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    clock.advanceTo(new Date(clock.now().getTime() + 100).toISOString());
    await scheduler.idle();
  }
  assert.ok(lines.some((l) => l.includes('scheduled w')));
  const at = Date.parse(lines.find((l) => l.includes('scheduled w')).slice(0, 24));
  assert.ok(at < Date.parse('2026-01-15T00:01:30Z'), 'before the 60 s rescan');
  await scheduler.stop();
});

// Retention and stopping

test('records older than keepDays are pruned on start and once a day', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', 'schedule: "0 8 * * *"\ntimezone: UTC'));
  await appendRun(f.state, record('daily', '2026-01-01T08:00:00.000Z'));
  await appendRun(f.state, record('daily', '2026-01-10T08:00:00.000Z'));
  await appendRun(f.state, record('daily', '2026-01-14T08:00:00.000Z'));
  const { clock, lines, scheduler } = await schedule(f, '2026-01-15T07:00:00Z', { keepDays: 7 });
  await scheduler.idle();
  assert.deepEqual((await readRuns(f.state, 'daily')).map((r) => r.start.slice(0, 10)), ['2026-01-10', '2026-01-14']);
  assert.ok(lines.some((l) => l.endsWith('pruned 1 run record older than 7 days')));
  clock.advanceTo('2026-01-18T07:00:01Z');
  await scheduler.idle();
  // 7 days before 18 Jan 07:00 is 11 Jan 07:00. The fake run writes no records of its own.
  assert.deepEqual((await readRuns(f.state, 'daily')).map((r) => r.start.slice(0, 10)), ['2026-01-14']);
  await scheduler.stop();
});

test('stop waits for running agents up to the grace time and schedules nothing more', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'm.md'), agentFile('m', 'schedule: "* * * * *"'));
  let finish;
  const hold = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const run = async (agent) => {
    calls.push(agent.name);
    await hold;
    return record(agent.name, '2026-01-15T07:01:00.000Z');
  };
  const { clock, scheduler, lines } = await schedule(f, '2026-01-15T07:00:30Z', { run });
  clock.advanceTo('2026-01-15T07:01:00Z');
  let stopped;
  const stopping = scheduler.stop().then((done) => { stopped = done; });
  clock.advanceTo('2026-01-15T07:01:30Z');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, undefined, 'still waiting for the run');
  finish();
  await stopping;
  assert.equal(stopped, true);
  clock.advanceTo('2026-01-15T07:10:00Z');
  assert.deepEqual(calls, ['m']);
  assert.ok(lines.some((l) => l.endsWith('finished m: success, 1 turn, $0.0100, delivered log')));

  // A run that outlasts the grace time does not hold the stop forever.
  const g = await folder();
  await writeFile(path.join(g.agents, 'm.md'), agentFile('m', 'schedule: "* * * * *"'));
  const stuck = await schedule(g, '2026-01-15T07:00:30Z', { run: () => new Promise(() => {}) });
  stuck.clock.advanceTo('2026-01-15T07:01:00Z');
  const late = stuck.scheduler.stop();
  stuck.clock.advanceTo('2026-01-15T07:02:00Z');
  assert.equal(await late, false);
});

test('the daemon state notes when each agent was last started', async () => {
  const f = await folder();
  await writeFile(path.join(f.agents, 'm.md'), agentFile('m', 'schedule: "0 * * * *"'));
  const { clock, scheduler } = await schedule(f, '2026-01-15T07:00:30Z');
  clock.advanceTo('2026-01-15T08:00:00Z');
  await scheduler.idle();
  const state = JSON.parse(await readFile(path.join(f.state, 'daemon.json'), 'utf8'));
  assert.deepEqual(state.started, { m: '2026-01-15T08:00:00.000Z' });
  await scheduler.stop();
});

// nightshift runs

test('runs shows the last N runs per agent, newest first, in the agent time zone', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = await folder();
  await writeFile(path.join(f.agents, 'daily.md'), agentFile('daily', MADRID_8));
  for (let day = 10; day <= 13; day++) await appendRun(f.state, record('daily', `2026-01-${day}T07:00:01.000Z`, { result: `day ${day}\nmore` }));
  await appendRun(f.state, record('daily', '2026-07-14T06:00:01.000Z', { status: 'missed', turns: null, costUsd: null, result: 'the daemon was not running' }));
  await appendRun(f.state, record('other', '2026-01-14T07:00:00.000Z', { turns: 3 }));
  const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', 'runs', ...args, '--agents', f.agents, '--state', f.state], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });

  const daily = cli('daily', '--last', '3');
  assert.equal(daily.status, 0);
  assert.equal(daily.stdout, [
    'daily (Europe/Madrid)',
    '  2026-07-14 08:00  missed      -         -         log      the daemon was not running',
    '  2026-01-13 08:00  success     1 turn    $0.0100   log      day 13',
    '  2026-01-12 08:00  success     1 turn    $0.0100   log      day 12',
    '', '',
  ].join('\n'));

  const all = cli();
  assert.match(all.stdout, /^daily \(Europe\/Madrid\)\n(  .*\n){5}\nother\n  2026-01-14 07:00  success     3 turns   \$0\.0100   log      done\n\n$/);
});
