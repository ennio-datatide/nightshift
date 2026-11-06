import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface RunRecord {
  agent: string;
  start: string;
  end: string;
  /** `success`, an SDK error subtype such as `error_max_turns`, or `error` when the session crashed. */
  status: string;
  turns: number | null;
  costUsd: number | null;
  result: string;
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
