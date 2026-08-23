import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginName = "com.courcelle.codex-controls.sdPlugin";
const source = join(root, pluginName);
const output = join(root, "dist");
const stage = join(output, pluginName);

if (!stage.startsWith(`${output}${sep}`)) {
  throw new Error("The package stage is outside the dist directory.");
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

run("npm", ["run", "build"]);

if (!existsSync(join(source, "bin", "plugin.js"))) {
  throw new Error("The plug-in bundle is missing after the build.");
}

rmSync(stage, { force: true, recursive: true });
mkdirSync(stage, { recursive: true });

for (const path of ["manifest.json", "bin", "ui", "imgs/actions"]) {
  cpSync(join(source, path), join(stage, path), { recursive: true });
}

mkdirSync(join(stage, "imgs", "plugin"), { recursive: true });
for (const name of [
  "category-icon.png",
  "category-icon@2x.png",
  "marketplace.png",
  "marketplace@2x.png",
]) {
  cpSync(
    join(source, "imgs", "plugin", name),
    join(stage, "imgs", "plugin", name),
  );
}

run("npx", [
  "--no-install",
  "streamdeck",
  "validate",
  stage,
  "--no-update-check",
]);
run("npx", [
  "--no-install",
  "streamdeck",
  "pack",
  stage,
  "--output",
  output,
  "--no-update-check",
]);
