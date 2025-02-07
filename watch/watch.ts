import { exists } from "@std/fs";
import { join, relative } from "@std/path";
import chokidar, { type EmitArgsWithName } from "chokidar";
import {
  call,
  createChannel,
  createSignal,
  Err,
  Ok,
  type Operation,
  resource,
  type Result,
  spawn,
  type Stream,
} from "effection";
import { default as createIgnore } from "ignore";
import { pipe } from "jsr:@gordonb/pipe@0.1.0";
import { readFile } from "node:fs/promises";

import { type Process, useProcess } from "./child-process.ts";
import { debounce, filter } from "./stream-helpers.ts";

export interface Watch extends Stream<Result<Process>, never> {}

/**
 * Options available to configure what is watched
 */
export interface WatchOptions {
  /**
   * The directory to watch
   */
  path: string;
  /**
   * The command to run (and re-run every time a change is detected)
   */
  cmd: string;

  /**
   * @ignore
   */
  event?: "all" | "change";
}

/**
 * Create a watch configuration that observes file system changes and executes a command
 * when changes are detected. The watch can be consumed as a stream of process starts.
 *
 * @example
 * ```ts
 * const watcher = yield* watch({
 *  path: './src',
 *  cmd: 'npm test'
 * });
 * ```
 *
 * @param options - Configuration options for the watch
 * @param options.path - The directory path to watch for changes
 * @param options.cmd - The command to execute when changes are detected
 * @param options.event - The type of event to watch for ('all' or 'change', defaults to 'all')
 *
 * @returns A Stream that emits Result<Process> for each command execution
 *
 * @remarks
 * - Uses chokidar for file system watching
 * - Respects .gitignore patterns if present
 * - Implements debouncing to prevent rapid successive executions
 * - Filters out stale events using the fresh() function
 *
 * @throws Will throw an error if the process execution fails
 *
 * @see {@link WatchOptions} for configuration options
 * @see {@link Process} for process execution details
 */
export function watch(options: WatchOptions): Watch {
  return resource(function* (provide) {
    let starts = createChannel<Result<Process>, never>();
    let input = createSignal<EmitArgsWithName, never>();

    let gitignored = yield* findIgnores(options.path);

    let watcher = chokidar.watch(options.path, {
      ignoreInitial: true,
    });
    let { event = "all" } = options;
    watcher.on(event, (...args: EmitArgsWithName) => {
      if (event !== "all") {
        args.unshift(event);
      }

      if (fresh(500)(args) && !gitignored(args)) {
        input.send(args);
      }
    });

    let changes = yield* pipe(input, debounce(100));

    yield* spawn(function* () {
      while (true) {
        let task = yield* spawn(function* () {
          try {
            let process = yield* useProcess(options.cmd);
            yield* starts.send(Ok(process));
          } catch (error) {
            yield* starts.send(Err(error as Error));
          }

          yield* changes.next();
        });
        yield* task;
      }
    });

    try {
      yield* provide(yield* starts);
    } finally {
      yield* call(() => watcher.close());
    }
  });
}

/**
 * locate a `.gitignore` file if it exists and use it to filter
 * out any change events against paths that are matched by it
 */
function* findIgnores(path: string): Operation<
  (args: EmitArgsWithName) => boolean
> {
  let gitignore = join(path, ".gitignore");
  if (yield* call(() => exists(gitignore))) {
    let ignores = createIgnore();
    let buffer = yield* call(() => readFile(gitignore));
    ignores.add(buffer.toString());
    return ([, pathname]) => {
      let relativePathname = relative(path, pathname).trim();
      return relativePathname !== "" && ignores.ignores(relativePathname);
    };
  } else {
    return () => false;
  }
}

function fresh(staletime: number): (args: EmitArgsWithName) => boolean {
  return ([, , stats]) => {
    return !stats || (Date.now() - stats.mtimeMs) < staletime;
  };
}
