import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { Cron } from 'croner';
import { parse } from 'yaml';

export type Delivery =
  | 'email'
  | 'log'
  | { type: 'email'; to?: string; from?: string; subject?: string }
  | { type: 'command'; command: string }
  | { type: 'log' };

export interface AgentDefinition {
  name: string;
  description: string;
  /** Cron expression; without one the agent only runs by hand. */
  schedule?: string;
  /** IANA time zone the schedule is read in; local time when unset. */
  timezone?: string;
  /** Absolute; a relative `cwd` is resolved against the agent file's folder. */
  cwd: string;
  /** Command run first; the agent is skipped when there is nothing to do. */
  gate?: string;
  model?: string;
  /** Only modes that never ask and never bypass: `dontAsk` (the default) or `plan`. */
  permissionMode?: Extract<PermissionMode, 'dontAsk' | 'plan'>;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMinutes?: number;
  /** Names of keys from the secrets file this agent receives. */
  secrets: string[];
  /** Folders it may read, as written (relative ones are relative to `cwd`). */
  read: string[];
  /** Command patterns it may run, such as `npm run -s decide:*`. */
  run: string[];
  /** Extra Claude Code tools, such as `Edit`. */
  tools: string[];
  disallowedTools: string[];
  skills?: string[];
  skillsDir?: string;
  mcpServers?: Record<string, object>;
  /** Names of other agent files in the same folder. */
  subagents?: string[];
  /** Reads text from strangers (comments, emails, web pages). */
  untrusted: boolean;
  /** Tool calls that are public actions, checked by a reviewer first. */
  review?: { tools: string[]; instructions?: string };
  deliver?: Delivery;
  /** A phrase in the result that means there is nothing to report. */
  quietWhen?: string;
  billing: 'subscription' | 'api';
  prompt: string;
  file: string;
}

/** One agent file as judged on its own and against its folder: the definition only when there are no errors. */
export interface LoadResult {
  file: string;
  /** The `name` setting as written, so a broken file can still be found by name. */
  name?: string;
  agent?: AgentDefinition;
  errors: string[];
}

/** Returns error messages for one setting; empty when it is fine. */
type Rule = (value: unknown, key: string) => string[];

const show = (value: unknown): string => {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};
const wrong = (key: string, allowed: string, value: unknown, why?: string): string =>
  `${key} must be ${allowed}, got ${show(value)}${why ? ` (${why})` : ''}`;
const rule = (ok: (value: unknown) => boolean, allowed: string): Rule =>
  (value, key) => (ok(value) ? [] : [wrong(key, allowed, value)]);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isList = (value: unknown, item: (v: string) => boolean = () => true): value is string[] =>
  Array.isArray(value) && value.every((v) => isText(v) && item(v));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const oneOf = (choices: readonly string[]): Rule =>
  rule((v) => choices.includes(v as string), `one of ${choices.join(', ')}`);
const unknownKeys = (key: string, value: Record<string, unknown>, allowed: string[], what: string): string[] =>
  Object.keys(value).filter((k) => !allowed.includes(k)).map((k) => `unknown setting "${key}.${k}"; ${what} takes ${allowed.join(', ')}`);

/** `Bash(<command pattern>)`, matched like `run`, or a bare tool name such as `mcp__social__post`. */
const isReviewPattern = (v: string): boolean => /^Bash\(.+\)$/s.test(v) || /^[A-Za-z0-9_-]+$/.test(v);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isName = (v: unknown): boolean => typeof v === 'string' && NAME.test(v);
const isTimezone = (v: unknown): boolean => {
  if (!isText(v)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

const PERMISSION_MODES: PermissionMode[] = ['dontAsk', 'plan'];
const DELIVERY_FIELDS = { email: ['type', 'to', 'from', 'subject'], command: ['type', 'command'], log: ['type'] } as const;

const deliverRule: Rule = (value, key) => {
  if (value === 'command') {
    return [`${key}: command names no command; write ${key}: { type: command, command: "<command that receives the text on stdin>" }`];
  }
  if (typeof value === 'string' && value in DELIVERY_FIELDS) return [];
  if (!isObject(value) || !(typeof value.type === 'string' && value.type in DELIVERY_FIELDS)) {
    return [wrong(key, 'email, command, log or an object with a type', value)];
  }
  const type = value.type as keyof typeof DELIVERY_FIELDS;
  const errors: string[] = [];
  if (type === 'command' && !isText(value.command)) {
    errors.push(wrong(`${key}.command`, 'a command that receives the text on stdin', value.command));
  }
  for (const field of ['to', 'from'] as const) {
    if (type === 'email' && value[field] !== undefined && !isText(value[field])) {
      errors.push(wrong(`${key}.${field}`, 'a secret name or an address', value[field]));
    }
  }
  if (type === 'email' && value.subject !== undefined && !isText(value.subject)) {
    errors.push(wrong(`${key}.subject`, 'text', value.subject));
  }
  return [...errors, ...unknownKeys(key, value, [...DELIVERY_FIELDS[type]], `${type} delivery`)];
};

/** Every setting an agent file may have, in the order errors are reported. */
const RULES: Record<string, Rule> = {
  name: rule(isName, 'lowercase letters, digits and dashes, such as daily-summary'),
  description: rule(isText, 'one line saying what the agent does'),
  schedule: (value, key) => {
    if (!isText(value)) return [wrong(key, 'a cron expression such as "0 7 * * *"', value)];
    try {
      new Cron(value, { paused: true });
      return [];
    } catch (err) {
      return [wrong(key, 'a cron expression such as "0 7 * * *"', value, (err as Error).message)];
    }
  },
  timezone: rule(isTimezone, 'an IANA time zone such as Europe/Madrid'),
  cwd: rule(isText, 'a path'),
  gate: rule(isText, 'a command'),
  secrets: rule((v) => isList(v, (s) => ENV_NAME.test(s)), 'a list of names (letters, digits and underscores, such as MAIL_KEY)'),
  read: rule((v) => isList(v), 'a list of folders'),
  run: rule((v) => isList(v), 'a list of command patterns'),
  tools: rule((v) => isList(v), 'a list of tool names'),
  disallowedTools: rule((v) => isList(v), 'a list of tool rules'),
  permissionMode: (value, key) =>
    PERMISSION_MODES.includes(value as PermissionMode)
      ? []
      : [wrong(key, 'dontAsk (the default) or plan', value, 'unattended agents must not bypass permissions')],
  model: rule(isText, 'a model name'),
  effort: oneOf(['low', 'medium', 'high', 'xhigh', 'max']),
  maxTurns: rule((v) => Number.isInteger(v) && (v as number) > 0, 'a positive whole number'),
  maxBudgetUsd: rule(isPositive, 'a positive number'),
  timeoutMinutes: rule(isPositive, 'a positive number'),
  skills: rule((v) => isList(v), 'a list of skill names'),
  skillsDir: rule(isText, 'a path'),
  mcpServers: (value, key) => {
    if (!isObject(value)) return [wrong(key, 'an object of server configs by name', value)];
    return Object.entries(value)
      .filter(([, server]) => !isObject(server))
      .map(([name, server]) => wrong(`${key}.${name}`, 'a server config (an object)', server));
  },
  subagents: rule((v) => isList(v, isName), 'a list of agent names'),
  untrusted: rule((v) => typeof v === 'boolean', 'true or false'),
  review: (value, key) => {
    if (!isObject(value)) return [wrong(key, 'an object with tools and instructions', value)];
    const errors: string[] = [];
    if (!isList(value.tools, isReviewPattern) || !value.tools.length) {
      errors.push(wrong(`${key}.tools`, 'a list of tool patterns, each Bash(<command pattern>) or a tool name', value.tools));
    }
    if (value.instructions !== undefined && !isText(value.instructions)) {
      errors.push(wrong(`${key}.instructions`, 'text', value.instructions));
    }
    return [...errors, ...unknownKeys(key, value, ['tools', 'instructions'], 'review')];
  },
  deliver: deliverRule,
  quietWhen: rule(isText, 'a phrase'),
  billing: rule((v) => v === 'subscription' || v === 'api', 'subscription or api'),
};
const REQUIRED = {
  name: 'name is required (lowercase letters, digits and dashes, such as daily-summary)',
  description: 'description is required (one line saying what the agent does)',
};
/** Settings copied to the definition as written when present. */
const OPTIONAL = [
  'schedule', 'timezone', 'gate', 'model', 'permissionMode', 'effort', 'maxTurns', 'maxBudgetUsd', 'timeoutMinutes',
  'skills', 'skillsDir', 'mcpServers', 'subagents', 'review', 'deliver', 'quietWhen',
] as const;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Judges one file on its own; subagent names and duplicate names need the folder (see `loadFolder`). */
export async function checkFile(file: string): Promise<LoadResult> {
  const text = await readFile(file, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) return { file, errors: ['missing frontmatter (settings between --- lines at the top)'] };
  let settings: unknown;
  try {
    settings = parse(match[1]) ?? {};
  } catch (err) {
    return { file, errors: [`the frontmatter is not valid YAML: ${(err as Error).message.split('\n')[0]}`] };
  }
  if (!isObject(settings)) return { file, errors: ['frontmatter must be a list of settings'] };

  const errors: string[] = [];
  for (const [key, check] of Object.entries(RULES)) {
    const value = settings[key];
    if (value === undefined) {
      if (key in REQUIRED) errors.push(REQUIRED[key as keyof typeof REQUIRED]);
    } else {
      errors.push(...check(value, key));
    }
  }
  const allowed = Object.keys(RULES);
  for (const key of Object.keys(settings)) {
    if (!allowed.includes(key)) errors.push(`unknown setting "${key}"; the settings are ${allowed.join(', ')}`);
  }
  if (settings.untrusted === true && Array.isArray(settings.run) && settings.run.length && settings.review === undefined) {
    errors.push('untrusted agents must review their public actions: add review with the tools that act in public');
  }
  if (settings.skills !== undefined && settings.skillsDir === undefined) {
    errors.push('skills names skills in skillsDir: add skillsDir, the folder that holds them (each a subfolder with SKILL.md)');
  }
  const prompt = match[2].trim();
  if (!prompt) errors.push('the prompt below the frontmatter is empty');

  const name = typeof settings.name === 'string' ? settings.name : undefined;
  if (errors.length) return { file, name, errors };
  return { file, name, agent: toDefinition(file, settings, prompt), errors };
}

function toDefinition(file: string, settings: Record<string, unknown>, prompt: string): AgentDefinition {
  const list = (key: string): string[] => (settings[key] as string[] | undefined) ?? [];
  // Resolve against the file, not the shell's folder, so the agent starts in the same place every time.
  const agent: AgentDefinition = {
    name: settings.name as string,
    description: settings.description as string,
    cwd: path.resolve(path.dirname(file), (settings.cwd as string | undefined) ?? '.'),
    secrets: list('secrets'),
    read: list('read'),
    run: list('run'),
    tools: list('tools'),
    disallowedTools: list('disallowedTools'),
    untrusted: (settings.untrusted as boolean | undefined) ?? false,
    billing: (settings.billing as AgentDefinition['billing'] | undefined) ?? 'subscription',
    prompt,
    file,
  };
  for (const key of OPTIONAL) if (settings[key] !== undefined) Object.assign(agent, { [key]: settings[key] });
  return agent;
}

/** Loads one file, throwing every error in it, one per line, each with the file. */
export async function loadAgent(file: string): Promise<AgentDefinition> {
  const result = await checkFile(file);
  if (!result.agent) throw new Error(describeErrors(result));
  return result.agent;
}

/** Judges every .md file directly in `dir`, including subagent names and names used twice. */
export async function loadFolder(dir: string): Promise<LoadResult[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const results = await Promise.all(files.map((f) => checkFile(path.join(dir, f))));
  for (const result of results) {
    const extra: string[] = [];
    for (const other of results) {
      if (other !== result && result.name !== undefined && other.name === result.name) {
        extra.push(`name "${result.name}" is also used by ${path.basename(other.file)}`);
      }
    }
    for (const sub of result.agent?.subagents ?? []) {
      if (sub === result.name || !results.some((other) => other.name === sub)) {
        extra.push(`subagents names "${sub}", but no other agent file in this folder has that name`);
      }
    }
    if (extra.length) {
      result.errors.push(...extra);
      delete result.agent;
    }
  }
  return results;
}

/** Each error on its own line, prefixed with the file. */
export function describeErrors(result: LoadResult): string {
  return result.errors.map((error) => `${result.file}: ${error}`).join('\n');
}

/**
 * Finds an agent by its `name` setting among the .md files directly in `dir`. Only that file
 * and the subagents it names have to be valid; `nightshift check` judges the rest.
 */
export async function findAgent(dir: string, name: string): Promise<AgentDefinition> {
  const results = await loadFolder(dir);
  const result = results.find((r) => r.name === name);
  if (!result) throw new Error(`no agent named "${name}" in ${dir}`);
  if (!result.agent) throw new Error(describeErrors(result));
  for (const sub of result.agent.subagents ?? []) {
    const broken = results.find((r) => r.name === sub && !r.agent);
    if (broken) throw new Error(`${name} uses subagent ${sub}, which is broken:\n${describeErrors(broken)}`);
  }
  return result.agent;
}
