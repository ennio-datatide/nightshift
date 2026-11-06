import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition } from './loader.js';

/**
 * The one place an agent definition becomes SDK options. Everything the session is allowed
 * to do is decided here, so a policy layer (tools, denies, environment) can take this over.
 */
export function buildOptions(agent: AgentDefinition): Options {
  const options: Options = { cwd: agent.cwd };
  if (agent.model !== undefined) options.model = agent.model;
  if (agent.maxTurns !== undefined) options.maxTurns = agent.maxTurns;
  return options;
}
