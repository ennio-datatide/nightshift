#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { findAgent } from './loader.js';
import { buildOptions } from './options.js';
import { runAgent } from './runner.js';

const USAGE = `Usage: nightshift run <agent> [--agents <dir>] [--state <dir>] [--dry-run]

  --agents <dir>  folder of agent files (default ./agents)
  --state <dir>   folder for run records (default ./state)
  --dry-run       show the prompt and options without starting Claude`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: 'string', default: './agents' },
      state: { type: 'string', default: './state' },
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
  if (values['dry-run']) {
    console.log(`Prompt:\n${agent.prompt}\n\nOptions:\n${JSON.stringify(buildOptions(agent), null, 2)}`);
    return 0;
  }

  const record = await runAgent(agent, { query, stateDir: values.state });
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
