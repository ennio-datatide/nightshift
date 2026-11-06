import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';
import { parse, stringify } from 'yaml';
import type { AgentDefinition } from './loader.js';

/**
 * Skills reach the session as one local plugin that nightshift writes for each agent, since with
 * `settingSources: []` Claude Code reads no skills folder of its own. The plugin holds only the
 * enabled skills, each SKILL.md rewritten without the settings that grant powers (`allowed-tools`,
 * `hooks` and the like), and links to the skill's other files.
 */
const PLUGIN_NAME = 'nightshift';
/** SKILL.md settings that only describe the skill; every other one is dropped. */
const SKILL_FIELDS = ['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'license', 'version', 'metadata'];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Skill name to its folder: the listed ones, or every one in `skillsDir` when `skills` is not set. */
export async function enabledSkills(agent: AgentDefinition): Promise<Map<string, string>> {
  if (!agent.skillsDir) return new Map();
  const dir = path.resolve(agent.cwd, agent.skillsDir.replace(/^~(?=$|\/)/, homedir()));
  const entries = await readdir(dir).catch(() => {
    throw new Error(`${agent.name}: skillsDir ${dir} is not a folder that can be read`);
  });
  const available: string[] = [];
  for (const entry of entries) {
    if (await stat(path.join(dir, entry, 'SKILL.md')).then((s) => s.isFile(), () => false)) available.push(entry);
  }
  const names = agent.skills ?? available.sort();
  const missing = names.filter((name) => !available.includes(name));
  if (missing.length) throw new Error(`${agent.name}: skills ${missing.join(', ')} not found in ${dir} (each skill is a folder with SKILL.md)`);
  return new Map(names.map((name) => [name, path.join(dir, name)]));
}

/** Writes the agent's plugin afresh (one per agent name, so runs never pile up folders). */
export async function skillsPlugin(agent: AgentDefinition, skills: Map<string, string>): Promise<SdkPluginConfig> {
  const root = path.join(tmpdir(), 'nightshift-skills', agent.name);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, description: `Skills of ${agent.name}` }));
  for (const [name, source] of skills) {
    const target = path.join(root, 'skills', name);
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry === 'SKILL.md') await writeFile(path.join(target, entry), withoutPowers(await readFile(path.join(source, entry), 'utf8')));
      else await symlink(path.join(source, entry), path.join(target, entry));
    }
  }
  // The plugin has no MCP servers; the agent's own come from its file.
  return { type: 'local', path: root, skipMcpDiscovery: true };
}

/** Keeps only the describing settings, so a skill cannot allow tools or add hooks. */
function withoutPowers(text: string): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  const settings = (parse(match[1]) ?? {}) as Record<string, unknown>;
  const kept = Object.fromEntries(SKILL_FIELDS.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
  return `---\n${stringify(kept)}---\n${match[2]}`;
}
