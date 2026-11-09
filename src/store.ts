import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewDecision } from './reviewer.js';

export interface RunRecord {
  agent: string;
  start: string;
  end: string;
  /**
   * `success`, `skipped` (the gate found nothing to do, or a run was already going), `timeout`,
   * an SDK error subtype such as `error_max_turns` or `error_max_budget_usd`, `error` when
   * the session crashed, `gate-error` when the gate failed, or `missed` when the daemon was
   * down for more than an hour past the scheduled time.
   */
  status: string;
  turns: number | null;
  costUsd: number | null;
  result: string;
  /** Every reviewer decision on a public action during the run, in order. */
  reviews: ReviewDecision[];
  /** `email`, `command` or `log`; `quiet` when quietWhen matched; `failed: <reason>` when delivery failed. */
  delivered: string;
  /** How the gate ended, when it stopped the run. */
  gate?: { code: number | null; stderr: string };
}

/** Appends one run to `<stateDir>/<agent>.jsonl`; records are only ever removed by `pruneRuns`. */
export async function appendRun(stateDir: string, record: RunRecord): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(path.join(stateDir, `${record.agent}.jsonl`), JSON.stringify(record) + '\n');
}

/** Every record for `agent`, oldest first; empty when it has never run. */
export async function readRuns(stateDir: string, agent: string): Promise<RunRecord[]> {
  const text = await readOrEmpty(path.join(stateDir, `${agent}.jsonl`));
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RunRecord);
}

/** The newest record for `agent`, or undefined when it has never run. */
export async function lastRun(stateDir: string, agent: string): Promise<RunRecord | undefined> {
  const last = (await readOrEmpty(path.join(stateDir, `${agent}.jsonl`))).trimEnd().split('\n').pop();
  return last ? (JSON.parse(last) as RunRecord) : undefined;
}

/** The names of the agents with run records in `stateDir`. */
export async function recordedAgents(stateDir: string): Promise<string[]> {
  const files = await readdir(stateDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [] as string[];
    throw err;
  });
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length)).sort();
}

/**
 * Removes the records that started before `cutoff` and returns how many went. Each agent's file
 * is rewritten under its lock, so a run that is going is left alone until the next prune.
 */
export async function pruneRuns(stateDir: string, cutoff: Date): Promise<number> {
  let removed = 0;
  for (const agent of await recordedAgents(stateDir)) {
    const release = await takeLock(stateDir, agent);
    if (!release) continue;
    try {
      const runs = await readRuns(stateDir, agent);
      const kept = runs.filter((run) => Date.parse(run.start) >= cutoff.getTime());
      if (kept.length === runs.length) continue;
      const file = path.join(stateDir, `${agent}.jsonl`);
      await writeFile(`${file}.tmp`, kept.map((run) => JSON.stringify(run) + '\n').join(''));
      await rename(`${file}.tmp`, file);
      removed += runs.length - kept.length;
    } finally {
      await release();
    }
  }
  return removed;
}

/** What the daemon remembers between restarts: when it last started each agent. */
export interface DaemonState {
  started: Record<string, string>;
}

export async function readDaemonState(stateDir: string): Promise<DaemonState> {
  const text = await readOrEmpty(path.join(stateDir, 'daemon.json'));
  return text ? (JSON.parse(text) as DaemonState) : { started: {} };
}

export async function writeDaemonState(stateDir: string, state: DaemonState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, 'daemon.json');
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

function readOrEmpty(file: string): Promise<string> {
  return readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return '';
    throw err;
  });
}

/** The locks this process holds now, to tell its own runs from a lock left before a restart. */
const held = new Set<string>();

/**
 * Takes `<stateDir>/<agent>.lock`, holding this process's pid. Returns the release, or undefined
 * when a live process holds it; a lock left by a process that is gone is cleared. So is a lock with
 * this process's own pid that it did not take: in a container the daemon is pid 1 after every
 * restart, so a lock left by the previous daemon would otherwise look alive forever.
 */
export async function takeLock(stateDir: string, agent: string): Promise<(() => Promise<void>) | undefined> {
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, `${agent}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, String(process.pid), { flag: 'wx' });
      held.add(file);
      return async () => {
        held.delete(file);
        await rm(file, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const pid = Number((await readFile(file, 'utf8').catch(() => '')).trim());
    const stale = pid === process.pid ? !held.has(file) : !isAlive(pid);
    if (!stale) return undefined;
    await rm(file, { force: true });
  }
  return undefined;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
