import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export interface AgentDefinition {
  name: string;
  description: string;
  /** Absolute; a relative `cwd` is resolved against the agent file's folder. */
  cwd: string;
  model?: string;
  maxTurns?: number;
  /** Names of keys from the secrets file this agent receives. */
  secrets: string[];
  /** Folders it may read, as written (relative ones are relative to `cwd`). */
  read: string[];
  /** Command patterns it may run, such as `npm run -s decide:*`. */
  run: string[];
  /** Extra Claude Code tools, such as `Edit`. */
  tools: string[];
  disallowedTools: string[];
  /** Reads text from strangers (comments, emails, web pages). */
  untrusted: boolean;
  billing: 'subscription' | 'api';
  prompt: string;
  file: string;
}

const LISTS = {
  secrets: 'names',
  read: 'folders',
  run: 'command patterns',
  tools: 'tool names',
  disallowedTools: 'tool rules',
} as const;

const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export async function loadAgent(file: string): Promise<AgentDefinition> {
  const text = await readFile(file, 'utf8');
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message}`);
  };

  const match = FRONTMATTER.exec(text);
  if (!match) return fail('missing frontmatter (settings between --- lines at the top)');
  const settings = parse(match[1]) ?? {};
  if (typeof settings !== 'object' || Array.isArray(settings)) return fail('frontmatter must be a list of settings');

  const { name, description, cwd, model, maxTurns, untrusted, billing } = settings as Record<string, unknown>;
  if (typeof name !== 'string' || !name) return fail('name is required');
  if (typeof description !== 'string' || !description) return fail('description is required');
  if (cwd !== undefined && typeof cwd !== 'string') fail('cwd must be a path');
  if (model !== undefined && typeof model !== 'string') fail('model must be a model name');
  if (maxTurns !== undefined && !(Number.isInteger(maxTurns) && (maxTurns as number) > 0)) {
    fail('maxTurns must be a positive whole number');
  }
  for (const [key, noun] of Object.entries(LISTS)) {
    const value = (settings as Record<string, unknown>)[key];
    if (value !== undefined && !isList(value)) fail(`${key} must be a list of ${noun}`);
  }
  if (untrusted !== undefined && typeof untrusted !== 'boolean') fail('untrusted must be true or false');
  if (billing !== undefined && billing !== 'subscription' && billing !== 'api') fail('billing must be subscription or api');
  const list = (key: keyof typeof LISTS): string[] => (settings as Record<string, string[] | undefined>)[key] ?? [];
  const prompt = match[2].trim();
  if (!prompt) return fail('the prompt below the frontmatter is empty');

  // Resolve against the file, not the shell's folder, so the agent starts in the same place every time.
  const agent: AgentDefinition = {
    name,
    description,
    cwd: path.resolve(path.dirname(file), (cwd as string | undefined) ?? '.'),
    secrets: list('secrets'),
    read: list('read'),
    run: list('run'),
    tools: list('tools'),
    disallowedTools: list('disallowedTools'),
    untrusted: (untrusted as boolean | undefined) ?? false,
    billing: (billing as AgentDefinition['billing'] | undefined) ?? 'subscription',
    prompt,
    file,
  };
  if (model !== undefined) agent.model = model as string;
  if (maxTurns !== undefined) agent.maxTurns = maxTurns as number;
  return agent;
}

/** Finds an agent by its `name` setting among the .md files directly in `dir`. */
export async function findAgent(dir: string, name: string): Promise<AgentDefinition> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) {
    const agent = await loadAgent(path.join(dir, f));
    if (agent.name === name) return agent;
  }
  throw new Error(`no agent named "${name}" in ${dir}`);
}
