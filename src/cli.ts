#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Cron } from 'croner';
import { describeErrors, findAgent, loadFolder, type AgentDefinition } from './loader.js';
import { buildSession, describeOptions } from './policy.js';
import { runAgent } from './runner.js';
import { lastRun } from './store.js';

const USAGE = `Usage: nightshift run <agent> [--agents <dir>] [--state <dir>] [--secrets <file>] [--dry-run]
       nightshift check [--agents <dir>]
       nightshift list [--agents <dir>] [--state <dir>]

  run               start one agent now
  check             validate every agent file in the folder
  list              show each agent with its schedule, next run and last run

  --agents <dir>    folder of agent files (default ./agents)
  --state <dir>     folder for run records (default ./state)
  --secrets <file>  KEY=value file read for each run (default $NIGHTSHIFT_SECRETS)
  --dry-run         show the prompt and options (env key names only) without starting Claude`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: 'string', default: './agents' },
      state: { type: 'string', default: './state' },
      secrets: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, name] = positionals;
  if (!values.help && command === 'check') return check(values.agents);
  if (!values.help && command === 'list') return list(values.agents, values.state);
  if (values.help || command !== 'run' || !name) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const agent = await findAgent(values.agents, name);
  const secrets = values.secrets ?? process.env.NIGHTSHIFT_SECRETS;
  const secretsFile = secrets ? path.resolve(secrets) : undefined;
  if (values['dry-run']) {
    const { prompt, options } = await buildSession(agent, secretsFile);
    console.log(`Prompt:\n${prompt}\n\nOptions:\n${JSON.stringify(describeOptions(options), null, 2)}`);
    return 0;
  }

  const record = await runAgent(agent, { query, stateDir: values.state, secretsFile });
  if (record.status === 'success') {
    console.log(record.result);
    return 0;
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

function schedule({ schedule, timezone }: AgentDefinition): string {
  if (!schedule) return 'manual';
  const next = new Cron(schedule, { paused: true, timezone }).nextRun();
  return `${schedule} (${timezone ?? 'local time'}), next ${next ? formatTime(next, timezone) : 'never'}`;
}

/** `2026-11-07 07:00` in the agent's time zone, or local time. */
function formatTime(date: Date, timeZone?: string): string {
  return date.toLocaleString('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
