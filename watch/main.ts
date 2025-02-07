import { each, exit, main, scoped, spawn } from "effection";
import { watch } from "./watch.ts";
import { parser } from "zod-opts";
import { z } from "zod";
import process from "node:process";
import denoJson from "./deno.json" with { type: "json" };

const builtins = ["-h", "--help", "-V", "--version"];

await main(function* (argv) {
  let { args, rest } = extract(argv);
  parser()
    .name("watch")
    .description(
      "run a command, and restart it every time a source file in a directory changes",
    )
    .args([
      {
        name: "command",
        type: z.array(z.string()).optional(),
      },
    ])
    .version(denoJson.version)
    .parse(args);

  if (rest.length === 0) {
    yield* exit(5, "no command specified to watch");
  }

  let command = rest.join(" ");

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

interface Extract {
  args: string[];
  rest: string[];
}

function extract(argv: string[]): Extract {
  let args: string[] = [];
  let rest: string[] = argv.slice();

  for (let arg = rest.shift(); arg; arg = rest.shift()) {
    if (builtins.includes(arg)) {
      args.push(arg);
    } else {
      rest.unshift(arg);
      break;
    }
  }
  return { args, rest };
}
