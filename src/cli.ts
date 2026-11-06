#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Cron } from 'croner';
import { describeErrors, findAgent, loadFolder, type AgentDefinition } from './loader.js';
import { buildSession, describeOptions } from './policy.js';
import { runAgent } from './runner.js';
import { formatTime, startScheduler } from './scheduler.js';
import { lastRun, readRuns, recordedAgents, type RunRecord } from './store.js';

const USAGE = `Usage: nightshift run <agent> [--agents <dir>] [--state <dir>] [--secrets <file>] [--dry-run]
       nightshift check [--agents <dir>]
       nightshift list [--agents <dir>] [--state <dir>]
       nightshift daemon [--agents <dir>] [--state <dir>] [--secrets <file>] [--keep-days 30]
       nightshift runs [agent] [--last 10] [--agents <dir>] [--state <dir>]

  run               start one agent now
  check             validate every agent file in the folder
  list              show each agent with its schedule, next run and last run
  daemon            run every scheduled agent on time, following changes to the folder
  runs              show recent runs, newest first

  --agents <dir>    folder of agent files (default ./agents)
  --state <dir>     folder for run records (default ./state)
  --secrets <file>  KEY=value file read for each run (default $NIGHTSHIFT_SECRETS)
  --dry-run         show the prompt, options (env key names only, MCP servers as written), skills, subagents and reviewed actions without starting Claude
  --keep-days <n>   the daemon prunes run records older than this once a day (default 30)
  --last <n>        runs shown per agent (default 10)`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: 'string', default: './agents' },
      state: { type: 'string', default: './state' },
      secrets: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'keep-days': { type: 'string', default: '30' },
      last: { type: 'string', default: '10' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, name] = positionals;
  if (!values.help && command === 'check') return check(values.agents);
  if (!values.help && command === 'list') return list(values.agents, values.state);
  if (!values.help && command === 'runs') return runs(values.agents, values.state, name, count('--last', values.last));
  const secrets = values.secrets ?? process.env.NIGHTSHIFT_SECRETS;
  const secretsFile = secrets ? path.resolve(secrets) : undefined;
  if (!values.help && command === 'daemon') {
    return daemon(values.agents, values.state, secretsFile, count('--keep-days', values['keep-days']));
  }
  if (values.help || command !== 'run' || !name) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const agent = await findAgent(values.agents, name);
  if (values['dry-run']) {
    const { prompt, options } = await buildSession(agent, secretsFile);
    console.log(`Prompt:\n${prompt}\n\nOptions:\n${JSON.stringify(describeOptions(options, agent), null, 2)}`);
    const review = agent.review ? agent.review.tools.map((t) => `  ${t}`).join('\n') : '  none';
    console.log(`\nReviewed before running (public actions):\n${review}`);
    return 0;
  }

  const record = await runAgent(agent, { query, stateDir: values.state, secretsFile });
  if (record.delivered.startsWith('failed')) console.error(`${agent.name}: delivery ${record.delivered}`);
  if (record.status === 'skipped') {
    console.log(`${agent.name} skipped: ${record.result}`);
    return 0;
  }
  if (record.status === 'success') {
    console.log(record.result);
    return record.delivered.startsWith('failed') ? 1 : 0;
  }
  console.error(`${agent.name} failed (${record.status}): ${record.result}`);
  return 1;
}

async function check(dir: string): Promise<number> {
  const results = await loadFolder(dir);
  if (!results.length) {
    console.error(`no agent files (.md) in ${dir}`);
    return 1;
  }
  for (const result of results) {
    if (result.agent) console.log(`ok ${result.agent.name}`);
    else console.error(describeErrors(result));
  }
  return results.every((r) => r.agent) ? 0 : 1;
}

async function list(dir: string, stateDir: string): Promise<number> {
  const results = await loadFolder(dir);
  for (const { agent, file } of results) {
    if (!agent) {
      console.log(`${path.basename(file)}: broken, see nightshift check\n`);
      continue;
    }
    const last = await lastRun(stateDir, agent.name);
    console.log(`${agent.name}: ${agent.description}`);
    console.log(`  schedule  ${schedule(agent)}`);
    console.log(`  last run  ${last ? `${last.status}, ${formatTime(new Date(last.start), agent.timezone)}` : 'never'}\n`);
  }
  return results.every((r) => r.agent) ? 0 : 1;
}

/** Runs until SIGTERM or SIGINT, then waits up to 60 s for running agents and exits. */
async function daemon(agentsDir: string, stateDir: string, secretsFile: string | undefined, keepDays: number): Promise<never> {
  const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
  const scheduler = await startScheduler({
    agentsDir, stateDir, keepDays,
    run: (agent) => runAgent(agent, { query, stateDir, secretsFile }),
  });
  log(`daemon running: agents ${path.resolve(agentsDir)}, state ${path.resolve(stateDir)}, keeping ${keepDays} days of runs`);
  return new Promise(() => {
    let stopping = false;
    const onSignal = async (signal: NodeJS.Signals) => {
      // A second signal does not wait any longer.
      if (stopping) process.exit(1);
      stopping = true;
      log(`${signal}: stopping, waiting up to 60 s for running agents`);
      const finished = await scheduler.stop();
      log(finished ? 'stopped' : 'stopped with agents still running');
      // At once, even when an agent outlived the grace time and still holds the event loop.
      process.exit(finished ? 0 : 1);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
  });
}

/** Recent runs per agent, newest first, times in the agent's time zone. */
async function runs(agentsDir: string, stateDir: string, only: string | undefined, last: number): Promise<number> {
  const names = only ? [only] : await recordedAgents(stateDir);
  const results = await loadFolder(agentsDir).catch(() => []);
  if (!names.length) console.log(`no runs recorded in ${stateDir}`);
  for (const name of names) {
    const timezone = results.find((r) => r.name === name)?.agent?.timezone;
    const records = (await readRuns(stateDir, name)).slice(-last).reverse();
    console.log(`${name}${timezone ? ` (${timezone})` : ''}`);
    if (!records.length) console.log('  no runs');
    for (const record of records) console.log(`  ${runLine(record, timezone)}`);
    console.log('');
  }
  return 0;
}

/** Time, status, turns, cost, delivery and the first line of the result. */
function runLine(record: RunRecord, timezone?: string): string {
  const turns = record.turns === null ? '-' : `${record.turns} turn${record.turns === 1 ? '' : 's'}`;
  const cost = record.costUsd === null ? '-' : `$${record.costUsd.toFixed(4)}`;
  const firstLine = record.result.trim().split('\n')[0].slice(0, 100);
  const columns = [formatTime(new Date(record.start), timezone), record.status.padEnd(10), turns.padEnd(8), cost.padEnd(8), record.delivered.padEnd(7), firstLine];
  return columns.join('  ').trimEnd();
}

function count(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number of 1 or more, got ${value}`);
  return n;
}

function schedule({ schedule, timezone }: AgentDefinition): string {
  if (!schedule) return 'manual';
  const next = new Cron(schedule, { paused: true, timezone }).nextRun();
  return `${schedule} (${timezone ?? 'local time'}), next ${next ? formatTime(next, timezone) : 'never'}`;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
