import { call, type Operation } from "npm:effection@3.2.1";
import { resolve } from "jsr:@std/path@^1.0.6";
import { z } from "npm:zod@3.23.8";

export const DenoJson = z.object({
  name: z.string(),
  version: z.string(),
  exports: z.union([z.record(z.string()), z.string()]),
  license: z.string(),
});

export type PackageConfig = {
  workspace: string;
  workspacePath: string;
} & z.infer<typeof DenoJson>;

export function* readPackages(): Operation<PackageConfig[]> {
  const root = yield* call(() =>
    import("../../deno.json", {
      with: { type: "json" },
    })
  );

  console.log(`Found ${root.default.workspace.join(", ")}`);

  const configs: PackageConfig[] = [];
  for (let workspace of root.default.workspace) {
    const workspacePath = resolve(Deno.cwd(), workspace);

    const config = yield* call(() =>
      Deno.readTextFile(`${workspacePath}/deno.json`)
    );

    const denoJson = DenoJson.parse(JSON.parse(config));

    configs.push({
      ...denoJson,
      workspace: workspace.replace("./", ""),
      workspacePath,
    });
  }

  return configs;
}
