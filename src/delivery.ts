import type { AgentDefinition, Delivery } from './loader.js';
import { runShell } from './shell.js';

export const RESEND_URL = 'https://api.resend.com/emails';
const COMMAND_TIMEOUT_MS = 2 * 60_000;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface Message {
  text: string;
  /** Replaces the agent's subject, as failure notices do. */
  subject?: string;
}

export interface DeliveryDeps {
  fetch: typeof fetch;
  /** The whole secrets file: the Resend key and named addresses are read from here, not from any env. */
  secrets: Record<string, string>;
  /** The env of a delivery command (see `commandEnv`). */
  env: Record<string, string>;
}

/** Delivers `message` where the agent's file says. Returns what the run record notes; never throws. */
export async function deliver(agent: AgentDefinition, message: Message, deps: DeliveryDeps): Promise<string> {
  const target: Exclude<Delivery, string> =
    agent.deliver === 'email' ? { type: 'email' } : agent.deliver === 'log' || !agent.deliver ? { type: 'log' } : agent.deliver;
  try {
    if (target.type === 'email') await email(agent, target, message, deps);
    if (target.type === 'command') await command(agent, target.command, message.text, deps.env);
    return target.type;
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

type EmailTarget = Extract<Delivery, { type: 'email' }>;

async function email(agent: AgentDefinition, target: EmailTarget, message: Message, { fetch, secrets }: DeliveryDeps): Promise<void> {
  const key = secret(secrets, 'RESEND_API_KEY');
  // `to` and `from` are literal addresses, or names of secrets (REPORT_TO and REPORT_FROM by default).
  const address = (value: string): string => (SECRET_NAME.test(value) ? secret(secrets, value) : value);
  const firstLine = message.text.trim().split('\n')[0].slice(0, 80);
  const body = {
    from: address(target.from ?? 'REPORT_FROM'),
    to: [address(target.to ?? 'REPORT_TO')],
    subject: message.subject ?? target.subject ?? `${agent.name}: ${firstLine}`,
    text: message.text,
  };
  let response: Response;
  try {
    response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`could not reach Resend: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new Error(`Resend answered ${response.status}: ${(await response.text()).trim().slice(0, 300)}`);
}

async function command(agent: AgentDefinition, cmd: string, text: string, env: Record<string, string>): Promise<void> {
  const run = await runShell(cmd, { cwd: agent.cwd, env, input: text, timeoutMs: COMMAND_TIMEOUT_MS });
  if (run.error) throw new Error(`the delivery command could not start: ${run.error}`);
  if (run.timedOut) throw new Error('the delivery command did not finish within 2 minutes');
  if (run.code !== 0) {
    const stderr = run.stderr.trim().slice(0, 300);
    throw new Error(`the delivery command exited with code ${run.code}${stderr ? `: ${stderr}` : ''}`);
  }
}

function secret(secrets: Record<string, string>, name: string): string {
  const value = secrets[name];
  if (value === undefined || value === '') throw new Error(`${name} is missing from the secrets file`);
  return value;
}
