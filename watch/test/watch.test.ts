import type { Operation, Result, Stream } from "effection";
import { call, each, Ok, run, sleep, spawn } from "effection";
import { describe, it } from "jsr:@std/testing/bdd";
import { assert } from "jsr:@std/assert";
import { expect } from "jsr:@std/expect";
import { emptyDir } from "jsr:@std/fs/empty-dir";

describe("watch", () => {
  it("restarts the specified process when files change.", async () => {
    await run(function* () {
      let fixture = yield* useFixture({
        project: {
          "somefile.txt": "hello world",
        },
      });
      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `cat ${fixture.getPath("project/somefile.txt")}`,
        }),
      );

      let start = yield* processes.expectNext();

      let exit = yield* start.process;

      expect(exit.code).toEqual(0);

      expect(start.stdout).toEqual("hello world");

      yield* call(() =>
        fixture.writeFile("project/somefile.txt", "hello planet")
      );

      let next = yield* processes.expectNext();

      expect(next.stdout).toEqual("hello planet");
    });
  });

  it("ignores files in .gitignore", async () => {
    await run(function* () {
      let fixture = yield* useFixture({
        ".gitignore": "/dist",
        "src": {
          "file.txt": "this is a source file",
        },
        "dist": {
          "artifact.txt": "this is a built file",
        },
      });

      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `echo hello`,
        }),
      );

      //it starts the first time
      yield* processes.expectNext();

      yield* spawn(() =>
        call(() =>
          fixture.writeFile("dist/artifact.txt", "this file was built again")
        )
      );

      yield* processes.expectNoRestart();
    });
    // start in example directory with gitigoners
    // touch a change in an ignored file.
    // ensure that there was no restart
  });

  it.skip("ignores files in a .gitignore that is in a parent directory", () => {
    // start an example in a nested directory than the git ignore
    // touch a change in an ignored file within the directory
    // enuser that there was no restart;
  });

  it.skip("waits until stdout is closed before restarting", async () => {
    await run(function* () {
      let fixture = yield* useFixture({
        project: {
          "somefile.txt": "hello world",
        },
      });
      let processes = yield* inspector(
        watch({
          path: fixture.path,
          cmd: `deno run -A test/watch-graceful.ts`,
        }),
      );

      let first = yield* processes.expectNext();
      yield* call(() =>
        fixture.writeFile("project/somefile.txt", "hello planet")
      );

      yield* processes.expectNext();

      expect(first.stdout).toEqual("done");
    });

    // start an example that prints "done" to the console upon SIGINT
  });

  it.skip("allows for a hard kill ", () => {
    // start an example that will suspend asked to exit and so will
    // never exit.
    // send the command to exit the watch and the main returns
  });
});

import { createFixture, type FsFixture } from "npm:fs-fixture";
import { watch } from "../watch.ts";
import type { Process } from "../child-process.ts";

type FixtureOption = Parameters<typeof createFixture>;

function* useFixture(template: FixtureOption[0]): Operation<FsFixture> {
  let tempDir = new URL(import.meta.resolve("./fixtures")).pathname;
  yield* call(() => emptyDir(tempDir));
  let fixture = yield* call(() =>
    createFixture(template, {
      tempDir,
    })
  );
  yield* sleep(5);
  return fixture;
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
      yield* sleep(500);
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
