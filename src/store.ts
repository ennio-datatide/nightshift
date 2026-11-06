import { appendFile, mkdir } from 'node:fs/promises';
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
