import { watch as fsWatch } from 'node:fs';
import { Cron } from 'croner';
import { loadFolder, type AgentDefinition } from './loader.js';
import { appendRun, lastRun, pruneRuns, readDaemonState, writeDaemonState, type RunRecord } from './store.js';

/** Time and timers, injected so tests can move the clock by hand. */
export interface Clock {
  now(): Date;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

/** Calls `onChange` whenever something in `dir` changes; errors are reported to `onError`. */
export type WatchFn = (dir: string, onChange: () => void, onError: (err: unknown) => void) => { close(): void };

export interface SchedulerDeps {
  agentsDir: string;
  stateDir: string;
  /** Runs one agent once; the daemon passes the runner. */
  run: (agent: AgentDefinition) => Promise<RunRecord>;
  /** Run records older than this are pruned once a day; 30 by default. */
  keepDays?: number;
  clock?: Clock;
  /** Gets one line per event, already prefixed with the time; stdout by default. */
  log?: (line: string) => void;
  /** Watches the agents folder; `fs.watch` by default. Injected so tests can fire its events. */
  watch?: WatchFn;
}

export interface Scheduler {
  /** Settles once nothing is in progress: no reload, prune, state write or run. */
  idle(): Promise<void>;
  /** Stops scheduling and waits up to `graceMs` for running agents; true when they all finished. */
  stop(graceMs?: number): Promise<boolean>;
}

const RESCAN_MS = 60_000;
const DEBOUNCE_MS = 500;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;
const CATCH_UP_MS = 60 * 60_000;
const STOP_GRACE_MS = 60_000;
// setTimeout's limit; a longer wait is re-armed when the timer fires early.
const MAX_TIMER_MS = 2 ** 31 - 1;

const realWatch: WatchFn = (dir, onChange, onError) => {
  const watcher = fsWatch(dir, () => onChange());
  watcher.on('error', onError);
  // The rescan timer keeps the process alive; the watcher alone should not.
  watcher.unref();
  return watcher;
};

const realClock: Clock = {
  now: () => new Date(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

interface Job {
  agent: AgentDefinition;
  /** The definition as JSON, to tell a changed file from a touched one. */
  key: string;
  cron: Cron;
  next: Date | null;
  timer?: unknown;
}

/**
 * Schedules every agent in `agentsDir` that has a `schedule`, in its time zone, and keeps the jobs in
 * step with the folder. On start a run missed by less than an hour runs once; an older one is
 * recorded as missed.
 */
export async function startScheduler(deps: SchedulerDeps): Promise<Scheduler> {
  const { agentsDir, stateDir } = deps;
  const clock = deps.clock ?? realClock;
  const keepDays = deps.keepDays ?? 30;
  const log = (message: string) => (deps.log ?? console.log)(`${clock.now().toISOString()} ${message}`);
  const jobs = new Map<string, Job>();
  const broken = new Map<string, string>();
  const running = new Set<Promise<void>>();
  const timers = new Set<unknown>();
  const state = await readDaemonState(stateDir);
  let stateWrite = Promise.resolve();
  let reloading = Promise.resolve();
  let reloadQueued = false;
  let pruning = Promise.resolve();
  let stopping = false;

  const launch = (agent: AgentDefinition, why = '') => {
    // Noted before the run ends, so a restart in the middle of a run does not start it again.
    state.started[agent.name] = clock.now().toISOString();
    stateWrite = stateWrite
      .then(() => writeDaemonState(stateDir, state))
      .catch((err) => log(`could not write the daemon state: ${message(err)}`));
    log(`started ${agent.name}${why}`);
    const done: Promise<void> = deps.run(agent).then(
      (record) => log(record.status === 'skipped' ? `skipped ${agent.name}: ${record.result}` : `finished ${agent.name}: ${summary(record)}`),
      (err) => log(`failed ${agent.name}: ${message(err)}`),
    ).finally(() => running.delete(done));
    running.add(done);
  };

  const arm = (job: Job, next: Date | null) => {
    job.next = next;
    if (!next || stopping) return;
    const wait = Math.min(Math.max(0, next.getTime() - clock.now().getTime()), MAX_TIMER_MS);
    job.timer = clock.setTimer(() => fire(job), wait);
  };

  const fire = (job: Job) => {
    const due = job.next;
    if (stopping || !due || jobs.get(job.agent.file) !== job) return;
    if (clock.now() < due) return arm(job, due);
    launch(job.agent);
    // From now, not from `due`, so a late timer does not fire once for every time it slept through.
    const now = clock.now();
    arm(job, job.cron.nextRun(now > due ? now : due));
  };

  const drop = (file: string, why: string) => {
    const job = jobs.get(file);
    if (!job) return;
    clock.clearTimer(job.timer);
    jobs.delete(file);
    log(`removed ${job.agent.name}: ${why}`);
  };

  const reloadNow = async () => {
    reloadQueued = false;
    if (stopping) return;
    let results;
    try {
      results = await loadFolder(agentsDir);
    } catch (err) {
      log(`could not read the agents folder: ${message(err)}`);
      return;
    }
    const seen = new Set<string>();
    for (const result of results) {
      const { file, agent } = result;
      seen.add(file);
      if (!agent) {
        const errors = result.errors.join('; ');
        if (broken.get(file) !== errors) log(`file error ${file}: ${errors}`);
        broken.set(file, errors);
        drop(file, 'its file has errors, until it is fixed');
        continue;
      }
      broken.delete(file);
      if (!agent.schedule) {
        drop(file, 'it has no schedule');
        continue;
      }
      const key = JSON.stringify(agent);
      const old = jobs.get(file);
      if (old?.key === key) continue;
      if (old) clock.clearTimer(old.timer);
      const job: Job = { agent, key, cron: new Cron(agent.schedule, { paused: true, timezone: agent.timezone }), next: null };
      jobs.set(file, job);
      arm(job, job.cron.nextRun(clock.now()));
      const next = job.next ? formatTime(job.next, agent.timezone) : 'never';
      log(`${old ? 'reloaded' : 'scheduled'} ${agent.name}: ${agent.schedule} (${agent.timezone ?? 'local time'}), next ${next}`);
    }
    for (const file of [...jobs.keys()]) if (!seen.has(file)) drop(file, 'its file is gone');
    for (const file of [...broken.keys()]) if (!seen.has(file)) broken.delete(file);
  };

  // Reloads one at a time; a request while one is waiting adds nothing.
  const reload = () => {
    if (reloadQueued) return reloading;
    reloadQueued = true;
    reloading = reloading.then(reloadNow);
    return reloading;
  };

  const catchUp = async (job: Job) => {
    const { agent, cron } = job;
    const now = clock.now();
    const due = lastDue(cron, now);
    if (!due) return;
    const last = await lastRun(stateDir, agent.name);
    const seen = [last?.start, state.started[agent.name]].filter((t): t is string => !!t).map(Date.parse);
    // An agent that has never run has missed nothing.
    if (!seen.length || due.getTime() <= Math.max(...seen)) return;
    const late = now.getTime() - due.getTime();
    const when = formatTime(due, agent.timezone);
    if (late < CATCH_UP_MS) return launch(agent, ` (catching up ${when}, ${duration(late)} late)`);
    const result = `the daemon was not running at ${when} (${duration(late)} late)`;
    await appendRun(stateDir, {
      agent: agent.name, start: due.toISOString(), end: now.toISOString(), status: 'missed',
      turns: null, costUsd: null, result, reviews: [], delivered: 'log',
    });
    log(`missed ${agent.name}: ${result}`);
  };

  const prune = () => {
    const cutoff = new Date(clock.now().getTime() - keepDays * 24 * 60 * 60_000);
    pruning = pruning
      .then(() => pruneRuns(stateDir, cutoff))
      .then((removed) => {
        if (removed) log(`pruned ${removed} run record${removed === 1 ? '' : 's'} older than ${keepDays} days`);
      })
      .catch((err) => log(`could not prune run records: ${message(err)}`));
  };

  const every = (ms: number, fn: () => void) => {
    const timer = clock.setTimer(() => {
      timers.delete(timer);
      if (stopping) return;
      fn();
      every(ms, fn);
    }, ms);
    timers.add(timer);
  };

  await reload();
  for (const job of jobs.values()) await catchUp(job);
  prune();
  every(PRUNE_EVERY_MS, prune);
  every(RESCAN_MS, reload);

  let debounce: unknown;
  const watcher = (deps.watch ?? realWatch)(
    agentsDir,
    () => {
      if (stopping) return;
      clock.clearTimer(debounce);
      debounce = clock.setTimer(() => { reload(); }, DEBOUNCE_MS);
    },
    (err) => log(`stopped watching the agents folder: ${message(err)}`),
  );

  const idle = async () => {
    for (;;) {
      const pending = [reloading, stateWrite, pruning, ...running];
      await Promise.allSettled(pending);
      const after = [reloading, stateWrite, pruning, ...running];
      if (after.length === pending.length && after.every((p, i) => p === pending[i])) return;
    }
  };

  const stop = async (graceMs = STOP_GRACE_MS) => {
    stopping = true;
    watcher.close();
    clock.clearTimer(debounce);
    for (const timer of timers) clock.clearTimer(timer);
    for (const job of jobs.values()) clock.clearTimer(job.timer);
    let grace: unknown;
    const timeout = new Promise<boolean>((resolve) => { grace = clock.setTimer(() => resolve(false), graceMs); });
    const finished = await Promise.race([Promise.allSettled([...running]).then(() => true), timeout]);
    clock.clearTimer(grace);
    await stateWrite;
    return finished;
  };

  return { idle, stop };
}

/** The latest scheduled time at or before `now`; croner's previous runs are strictly before a whole second. */
function lastDue(cron: Cron, now: Date): Date | undefined {
  const [due] = cron.previousRuns(1, new Date(now.getTime() + 1000));
  return due && due <= now ? due : undefined;
}

function summary(record: RunRecord): string {
  const turns = record.turns === null ? 'no turns' : `${record.turns} turn${record.turns === 1 ? '' : 's'}`;
  const cost = record.costUsd === null ? 'no cost' : `$${record.costUsd.toFixed(4)}`;
  return `${record.status}, ${turns}, ${cost}, delivered ${record.delivered}`;
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `2026-11-07 07:00` in the agent's time zone, or local time. */
export function formatTime(date: Date, timeZone?: string): string {
  return date.toLocaleString('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}
