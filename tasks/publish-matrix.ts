import { call, main } from "npm:effection@3.2.1";
import { x } from "../tinyexec/mod.ts";
import { readPackages } from "./lib/read-packages.ts";

await main(function* () {
  let packages = yield* readPackages();

  let include: Record<string, unknown>[] = [];

  for (let pkg of packages) {
    let tagname = `${pkg.name.split("/")[1]}-v${pkg.version}`;

    let git = yield* x(`git`, [`tag`, `--list`, tagname]);

    let { stdout } = yield* git;

    // if output of `git tag --list ${{tagname}}` is empty, tag does not exists
    // ergo we publish
    if (stdout.trim() === "") {
      include.push({
        workspace: pkg.workspace,
        tagname,
        name: pkg.name,
        version: pkg.version,
      });
    }
  }

  let exists = include.length > 0;

  if (!exists) {
    include.push({ workspace: "nothing" });
  }

  let outputValue = [
    `exists=${exists}`,
    `matrix=${JSON.stringify({ include })}`,
  ].join("\n");

  console.log(outputValue);

  if (Deno.env.has("GITHUB_OUTPUT")) {
    const githubOutput = Deno.env.get("GITHUB_OUTPUT") as string;
    yield* call(() =>
      Deno.writeTextFile(githubOutput, outputValue, {
        append: true,
      })
    );
  }
});
