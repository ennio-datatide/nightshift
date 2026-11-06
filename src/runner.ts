import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { deliver, type Message } from './delivery.js';
import type { AgentDefinition } from './loader.js';
import { buildSession, commandEnv, readSecrets, requireSecrets } from './policy.js';
import type { ReviewDecision } from './reviewer.js';
import { runShell } from './shell.js';
import { appendRun, takeLock, type RunRecord } from './store.js';

/** The shape of the SDK's `query`, injected so tests can replace it. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export interface RunDeps {
  query: QueryFn;
  stateDir: string;
  /** The `secrets.env` read at the start of each run; the runner's own environment is never used. */
  secretsFile?: string;
  /** How long the reviewer may take on one public action; 60 s by default. */
  reviewTimeoutMs?: number;
  /** Used for email delivery; the global `fetch` by default. */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MINUTES = 30;
const GATE_TIMEOUT_MS = 2 * 60_000;
const GATE_OUTPUT_LIMIT = 20_000;

type Outcome = Pick<RunRecord, 'status' | 'turns' | 'costUsd' | 'result' | 'gate'>;

/** Runs one agent once, delivers the result and records the run, whatever the outcome. */
export async function runAgent(agent: AgentDefinition, deps: RunDeps): Promise<RunRecord> {
  const start = new Date().toISOString();
  const reviews: ReviewDecision[] = [];
  const save = async (outcome: Outcome, delivered: string): Promise<RunRecord> => {
    const record: RunRecord = { agent: agent.name, start, end: new Date().toISOString(), ...outcome, reviews, delivered };
    await appendRun(deps.stateDir, record);
    return record;
  };

  const release = await takeLock(deps.stateDir, agent.name);
  if (!release) return save({ status: 'skipped', turns: null, costUsd: null, result: 'already running' }, 'log');
  try {
    let secrets: Record<string, string> = {};
    let outcome: Outcome;
    try {
      if (deps.secretsFile) secrets = await readSecrets(deps.secretsFile);
      outcome = await session(agent, deps, secrets, reviews);
    } catch (err) {
      outcome = { status: 'error', turns: null, costUsd: null, result: err instanceof Error ? err.message : String(err) };
    }
    return save(outcome, await deliverOutcome(agent, outcome, secrets, deps.fetch ?? fetch));
  } finally {
    await release();
  }
}

/** The gate, then the session under its time limit. */
async function session(agent: AgentDefinition, deps: RunDeps, secrets: Record<string, string>, reviews: ReviewDecision[]): Promise<Outcome> {
  // A missing secret or an API key without `billing: api` fails before the gate or Claude starts.
  requireSecrets(agent, secrets, deps.secretsFile);
  let gateOutput: string | undefined;
  if (agent.gate) {
    const gate = await runGate(agent, agent.gate, secrets);
    if ('skip' in gate) return gate.skip;
    gateOutput = gate.output;
  }

  const minutes = agent.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), minutes * 60_000);
  const reviewer = { query: deps.query, timeoutMs: deps.reviewTimeoutMs, onDecision: (d: ReviewDecision) => reviews.push(d) };
  const outcome: Outcome = { status: 'error', turns: null, costUsd: null, result: 'the session ended without a result' };
  try {
    for await (const message of deps.query(await buildSession(agent, deps.secretsFile, reviewer, { gateOutput, abortController }))) {
      // The final `result` message carries everything the record needs.
      if (message.type !== 'result') continue;
      outcome.status = message.subtype;
      outcome.turns = message.num_turns;
      outcome.costUsd = message.total_cost_usd;
      outcome.result = message.subtype === 'success' ? message.result : message.errors.join('\n') || message.subtype;
    }
  } catch (err) {
    if (!abortController.signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
  }
  if (abortController.signal.aborted) {
    return { ...outcome, status: 'timeout', result: `stopped after ${minutes} minutes (timeoutMinutes)` };
  }
  return outcome;
}

/** Runs the gate in `cwd` with the agent's command env; nothing to do (non-zero exit or no output) skips the run. */
async function runGate(agent: AgentDefinition, gate: string, secrets: Record<string, string>): Promise<{ output: string } | { skip: Outcome }> {
  const run = await runShell(gate, { cwd: agent.cwd, env: commandEnv(agent, secrets), timeoutMs: GATE_TIMEOUT_MS });
  const output = run.stdout.trim().slice(0, GATE_OUTPUT_LIMIT);
  if (run.code === 0 && output) return { output };
  const stderr = run.stderr.trim().slice(0, 300);
  const reason = run.error
    ? `the gate could not start: ${run.error}`
    : run.timedOut
      ? 'the gate did not finish within 2 minutes'
      : run.code !== 0
        ? `the gate exited with code ${run.code}${stderr ? `: ${stderr}` : ''}`
        : 'the gate printed nothing';
  return { skip: { status: 'skipped', turns: null, costUsd: null, result: reason, gate: { code: run.code, stderr } } };
}

/** A failure is always delivered as a notice; a success unless quietWhen matches; a skip never. */
async function deliverOutcome(agent: AgentDefinition, outcome: Outcome, secrets: Record<string, string>, fetchFn: typeof fetch): Promise<string> {
  if (outcome.status === 'skipped') return 'log';
  const failed = outcome.status !== 'success';
  if (!failed && agent.quietWhen && outcome.result.toLowerCase().includes(agent.quietWhen.toLowerCase())) return 'quiet';
  const message: Message = failed
    ? { text: `${agent.name} failed: ${outcome.status}: ${outcome.result}`, subject: `${agent.name} failed: ${outcome.status}` }
    : { text: outcome.result };
  return deliver(agent, message, { fetch: fetchFn, secrets, env: commandEnv(agent, secrets) });
}
