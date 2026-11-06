import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition } from './loader.js';
import { buildSession } from './policy.js';
import { appendRun, type RunRecord } from './store.js';

/** The shape of the SDK's `query`, injected so tests can replace it. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export interface RunDeps {
  query: QueryFn;
  stateDir: string;
  /** The `secrets.env` read at the start of each run; the runner's own environment is never used. */
  secretsFile?: string;
}

/** Runs one agent once and records the run, whatever the outcome. */
export async function runAgent(agent: AgentDefinition, { query, stateDir, secretsFile }: RunDeps): Promise<RunRecord> {
  const start = new Date().toISOString();
  let status = 'error';
  let turns: number | null = null;
  let costUsd: number | null = null;
  let result = 'the session ended without a result';

  try {
    // A missing secret or an API key without `billing: api` fails here, before Claude starts.
    for await (const message of query(await buildSession(agent, secretsFile))) {
      // The final `result` message carries everything the record needs.
      if (message.type !== 'result') continue;
      status = message.subtype;
      turns = message.num_turns;
      costUsd = message.total_cost_usd;
      result = message.subtype === 'success' ? message.result : message.errors.join('\n') || message.subtype;
    }
  } catch (err) {
    status = 'error';
    result = err instanceof Error ? err.message : String(err);
  }

  const record: RunRecord = { agent: agent.name, start, end: new Date().toISOString(), status, turns, costUsd, result };
  await appendRun(stateDir, record);
  return record;
}
