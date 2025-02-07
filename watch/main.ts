import { each, main, scoped, spawn } from "effection";
import { watch } from "./watch.ts";
import { parser } from "zod-opts";
import { z } from "zod";
import process from "node:process";
import denoJson from "./deno.json" with { type: "json" };

await main(function* (args) {
  let options = parser()
    .name("watch")
    .description(
      "run a command, and restart it every time a source file in a directory changes",
    )
    .options({
      command: {
        type: z.string(),
        alias: "c",
        description: "the command to run",
      },
    })
    .version(denoJson.version)
    .parse(args);

  let { command } = options;

  let watcher = watch({
    path: process.cwd(),
    cmd: command,
  });

  for (let start of yield* each(watcher)) {
    process.stdout.write(`${command}\n`);
    yield* scoped(function* () {
      if (start.ok) {
        let proc = start.value;
        yield* spawn(function* () {
          for (let chunk of yield* each(proc.stdout)) {
            process.stdout.write(chunk);
            yield* each.next();
          }
        });
	yield* spawn(function* () {
          for (let chunk of yield* each(proc.stderr)) {
            process.stderr.write(chunk);
            yield* each.next();
          }
        });
      } else {
        console.error(`failed to start: ${start.error}`);
      }
      yield* each.next();
    });
  }
});
