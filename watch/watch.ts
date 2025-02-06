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
import { pipe } from "jsr:@gordonb/pipe";
import chokidar, { type EmitArgsWithName } from "chokidar";
import { default as createIgnore } from "ignore";

import { debounce, filter } from "./stream-helpers.ts";
import { type Process, useProcess } from "./child-process.ts";
import { exists } from "@std/fs";
import { join, relative } from "@std/path";
import { readFile } from "node:fs/promises";

export interface Watch extends Stream<Result<Process>, never> {}

export interface WatchOptions {
  path: string;
  cmd: string;
}

export function watch(options: WatchOptions): Watch {
  return resource(function* (provide) {
    let starts = createChannel<Result<Process>, never>();
    let input = createSignal<EmitArgsWithName, never>();
    let watcher = chokidar.watch(options.path);
    watcher.on("all", (...args) => {
      input.send(args);
    });

    let ignores = yield* findIgnores(options.path);
    let changes = yield* pipe(
      input,
      fresh(10),
      ignores,
      debounce(100),
    );

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
function* findIgnores(
  path: string,
): Operation<
  <R>(stream: Stream<EmitArgsWithName, R>) => Stream<EmitArgsWithName, R>
> {
  let gitignore = join(path, ".gitignore");
  if (yield* call(() => exists(gitignore))) {
    let ignores = createIgnore();
    let buffer = yield* call(() => readFile(gitignore));
    ignores.add(buffer.toString());
    return filter(([, pathname]) => ignores.ignores(relative(path, pathname)));
  } else {
    return filter(() => true);
  }
}

/**
 * filter out change events that happend more than {staletime} ago
 */
function fresh(
  staletime: number,
): <R>(stream: Stream<EmitArgsWithName, R>) => Stream<EmitArgsWithName, R> {
  return filter(([, , stats]) => {
    if (stats) {
      return (Date.now() - stats.atimeMs) < staletime;
    } else {
      return true;
    }
  });
}
