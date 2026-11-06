import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewDecision } from './reviewer.js';

export interface RunRecord {
  agent: string;
  start: string;
  end: string;
  /**
   * `success`, `skipped` (the gate found nothing to do, or a run was already going), `timeout`,
   * an SDK error subtype such as `error_max_turns` or `error_max_budget_usd`, or `error` when
   * the session crashed.
   */
  status: string;
  turns: number | null;
  costUsd: number | null;
  result: string;
  /** Every reviewer decision on a public action during the run, in order. */
  reviews: ReviewDecision[];
  /** `email`, `command` or `log`; `quiet` when quietWhen matched; `failed: <reason>` when delivery failed. */
  delivered: string;
  /** How the gate ended, when it skipped the run. */
  gate?: { code: number | null; stderr: string };
}

/** Appends one run to `<stateDir>/<agent>.jsonl`; records are never rewritten. */
export async function appendRun(stateDir: string, record: RunRecord): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(path.join(stateDir, `${record.agent}.jsonl`), JSON.stringify(record) + '\n');
}

/** The newest record for `agent`, or undefined when it has never run. */
export async function lastRun(stateDir: string, agent: string): Promise<RunRecord | undefined> {
  const text = await readFile(path.join(stateDir, `${agent}.jsonl`), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return '';
    throw err;
  });
  const last = text.trimEnd().split('\n').pop();
  return last ? (JSON.parse(last) as RunRecord) : undefined;
}

/**
 * Takes `<stateDir>/<agent>.lock`, holding this process's pid. Returns the release, or undefined
 * when a live process holds it; a lock left by a process that is gone is cleared.
 */
export async function takeLock(stateDir: string, agent: string): Promise<(() => Promise<void>) | undefined> {
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, `${agent}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, String(process.pid), { flag: 'wx' });
      return () => rm(file, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const pid = Number((await readFile(file, 'utf8').catch(() => '')).trim());
    if (isAlive(pid)) return undefined;
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
