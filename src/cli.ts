#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { findAgent } from './loader.js';
import { buildSession, describeOptions } from './policy.js';
import { runAgent } from './runner.js';

const USAGE = `Usage: nightshift run <agent> [--agents <dir>] [--state <dir>] [--secrets <file>] [--dry-run]

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

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
