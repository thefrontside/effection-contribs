import type { Operation, Result, Stream } from "effection";
import { call, each, Ok, run, sleep, spawn } from "effection";
import { describe, it } from "jsr:@std/testing/bdd";
import { assert } from "jsr:@std/assert";
import { expect } from "jsr:@std/expect";
import { emptyDir } from "jsr:@std/fs/empty-dir";

describe("watch", () => {
  it("restarts the specified process when files change.", async () => {
    await run(function* () {
      let fixture = yield* useFixture();
      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `cat ${fixture.getPath("src/file.txt")}`,
          event: "change",
        }),
      );

      let start = yield* processes.expectNext();

      let exit = yield* start.process;

      expect(exit.code).toEqual(0);

      expect(start.stdout).toEqual("this is a source file");

      yield* call(() =>
        fixture.write("src/file.txt", "this source file is changed")
      );

      let next = yield* processes.expectNext();

      expect(next.stdout).toEqual("this source file is changed");
    });
  });

  it("ignores files in .gitignore", async () => {
    await run(function* () {
      let fixture = yield* useFixture();

      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `echo hello`,
          event: "change",
        }),
      );

      //it starts the first time
      yield* processes.expectNext();

      yield* fixture.write("dist/artifact.txt", "this file was built again");

      yield* processes.expectNoRestart();
    });
  });

  it.skip("ignores files in a .gitignore that is in a parent directory", () => {
    // start an example in a nested directory than the git ignore
    // touch a change in an ignored file within the directory
    // enuser that there was no restart;
  });

  it("waits until stdout is closed before restarting", async () => {
    await run(function* () {
      let fixture = yield* useFixture();
      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `deno run -A test/watch-graceful.ts`,
        }),
      );

      let first = yield* processes.expectNext();

      yield* fixture.write("src/file.txt", "hello planet");

      yield* processes.expectNext();

      expect(first.stdout).toEqual("done\n");
    });

    // start an example that prints "done" to the console upon SIGINT
  });

  it.skip("allows for a hard kill ", () => {
    // start an example that will suspend asked to exit and so will
    // never exit.
    // send the command to exit the watch and the main returns
  });
});

import { watch } from "../watch.ts";
import type { Process } from "../child-process.ts";
import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";

interface Fixture {
  path: string;
  getPath(filename: "src/file.txt" | "dist/artifact.txt"): string;
  read(name: "src/file.txt"): Operation<string>;
  write(
    filename: "src/file.txt" | "dist/artifact.txt",
    content: string,
  ): Operation<void>;
}

function* useFixture(): Operation<Fixture> {
  let tmpDir = new URL(import.meta.resolve("./temp")).pathname;
  let fixtureDir = new URL(import.meta.resolve("./fixtures")).pathname;
  let path = join(tmpDir, "fixtures");
  yield* call(() => emptyDir(tmpDir));

  yield* call(() =>
    cp(fixtureDir, tmpDir, {
      recursive: true,
      preserveTimestamps: true,
      force: true,
    })
  );

  return {
    path,
    getPath(filename): string {
      return join(path, filename);
    },
    write(filename: string, content: string) {
      return call(async () => {
        const dest = join(path, filename);
        await ensureDir(dirname(dest));
        await writeFile(join(path, filename), content);
      });
    },
    *read(name) {
      return String(yield* call(() => readFile(join(path, name))));
    },
  };
}

type SuccessfulStart = {
  stdout: string;
  stderr: string;
  process: Process;
};

type ProcessStart = Result<SuccessfulStart>;

function* inspector(stream: Stream<Result<Process>, never>) {
  let starts: ProcessStart[] = [];

  let expected = 0;

  yield* spawn(function* () {
    for (let result of yield* each(stream)) {
      if (result.ok) {
        let process = result.value;
        let start = {
          stdout: "",
          stderr: "",
          process: result.value,
        };
        starts.push(Ok(start));
        yield* spawn(function* () {
          for (let chunk of yield* each(process.stdout)) {
            start.stdout += String(chunk);
            yield* each.next();
          }
        });
        yield* spawn(function* () {
          for (let chunk of yield* each(process.stderr)) {
            start.stderr += String(chunk);
            yield* each.next();
          }
        });
      } else {
        starts.push(result);
      }

      yield* each.next();
    }
  });

  let inspector = {
    starts,
    *expectNext(): Operation<SuccessfulStart> {
      let initial = expected;
      for (let i = 0; i < 100; i++) {
        if (initial < starts.length) {
          yield* sleep(10);
          expected = starts.length;
          let result = inspector.starts[inspector.starts.length - 1];
          if (result.ok) {
            return result.value;
          } else {
            throw new Error(
              `expected successful start, but failed: ${result.error}`,
            );
          }
        } else {
          yield* sleep(10);
        }
      }
      throw new Error(`expecting a sucessful start but it never appeared.`);
    },
    *expectNoRestart() {
      let prexisting = inspector.starts.length;
      yield* sleep(200);
      let restarts = inspector.starts.length - prexisting;
      assert(
        restarts === 0,
        `expected no process restarts to have happened, but instead there were: ${restarts}`,
      );
    },
  };
  return inspector;
}

// function* ntimeout<T>(op: () => Operation<T>): Operation<T> {
//   let result = yield* timebox<T>(1000, op);
//   if (result.timeout) {
//     throw new Error(`timeout`);
//   } else {
//     return result.value;
//   }
// };
