# effection-contrib

This repository contains a collection of contributions by the community. This
repository automatically publishes to JSR and NPM. All packages that were used
more than a few times are welcome.

## Adding a new package

1. Create a directory
2. Add a deno.json file with
   `{ "name": "@effection-contrib/<you_package_name>", version: "0.1.0", "exports": "./mod.ts", "license": "MIT" }`
3. Add a README.md (the first sentence of the README will be used as the
   description)
4. Add your source code and export it from `mod.ts`
5. Add doc strings to your source code - they will be used for documentation on
   the site.
