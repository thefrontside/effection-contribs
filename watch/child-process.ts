import { spawn as nodeSpawn } from "node:child_process";
import type { Operation, Stream } from "effection";
import {
  action,
  createSignal,
  resource,
  scoped,
  spawn,
  withResolvers,
} from "effection";

export interface ProcessResult {
  code: number;
  signal?: NodeJS.Signals;
}

export interface Process extends Operation<ProcessResult> {
  stdout: Stream<string, void>;
  stderr: Stream<string, void>;
  send(signal: NodeJS.Signals): void;
}

export function useProcess(command: string): Operation<Process> {
  return resource(function* (provide) {
    let closed = withResolvers<ProcessResult>();
    let stdout = createSignal<string, void>();
    let stderr = createSignal<string, void>();
    let nodeproc = nodeSpawn(command, {
      shell: true,
      stdio: "pipe",
    });

    // fail on an "error" event, but only until the process is successfully spawned.
    yield* spawn(function* () {
      yield* spawn(() =>
        action<void>((_, reject) => {
          nodeproc.on("error", reject);
          return () => nodeproc.off("error", reject);
        })
      );

      yield* action((resolve) => {
        nodeproc.on("spawn", resolve);
        return () => nodeproc.off("spawn", resolve);
      });
    });

    let onstdout = (chunk: unknown) => {
      stdout.send(String(chunk));
    };
    let onstderr = (chunk: unknown) => {
      console.log({ [`stderr: ${command}`]: String(chunk) });
      stderr.send(String(chunk));
    };
    let onclose = (code: number, signal?: NodeJS.Signals) => {
      stdout.close();
      stderr.close();
      closed.resolve({ code, signal });
    };

    try {
      nodeproc.stdout.on("data", onstdout);
      nodeproc.stderr.on("data", onstderr);
      nodeproc.on("close", onclose);

      yield* provide({
        [Symbol.iterator]: closed.operation[Symbol.iterator],
        stdout,
        stderr,
        *send(signal) {
          nodeproc.kill(signal);
        },
      });
    } finally {
      nodeproc.kill("SIGINT");
      nodeproc.kill("SIGTERM");
      yield* closed.operation;
      stdout.close();
      stderr.close();
      nodeproc.stdout.off("data", onstdout);
      nodeproc.stderr.off("data", onstderr);
      nodeproc.off("close", onclose);
    }
  });
}
