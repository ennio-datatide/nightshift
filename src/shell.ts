import { spawn } from 'node:child_process';

export interface ShellResult {
  /** The exit code; null when the command was killed or could not start. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why the command could not start, such as a missing folder. */
  error?: string;
}

/** Runs `command` with `/bin/sh -c` in `cwd` with exactly `env`, `input` on stdin. Never throws. */
export function runShell(
  command: string,
  { cwd, env, input = '', timeoutMs }: { cwd: string; env: Record<string, string>; input?: string; timeoutMs: number },
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, timeout: timeoutMs, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    let error: string | undefined;
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('error', (err) => { error = err.message; });
    // A command that does not read its stdin closes it early; that is not a failure.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    // Node kills the command when `timeout` passes, and only then sets `killed`.
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, timedOut: child.killed, error });
    });
  });
}
