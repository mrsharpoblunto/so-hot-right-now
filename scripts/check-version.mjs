import { readFileSync } from "node:fs";

// The agents read the plugin version, and npm reads the package version. They must agree.
const read = (file) =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).version;
const versions = {
  "package.json": read("package.json"),
  "plugin.json": read("plugins/so-hot-right-now/.claude-plugin/plugin.json"),
};
if (process.argv[2]) versions.tag = process.argv[2];
if (new Set(Object.values(versions)).size !== 1) {
  console.error(`Set one version in each place: ${JSON.stringify(versions)}`);
  process.exit(1);
}
