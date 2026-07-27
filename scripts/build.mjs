import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createPackagedManifest,
  readPackageVersion,
} from "./release-version.mjs";

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });

for (const file of [
  "options.html",
  "options.css",
  "popup.css",
  "popup.html",
]) {
  await cp(`src/${file}`, `dist/${file}`);
}

await cp("src/icons", "dist/icons", { recursive: true });

const manifestTemplate = JSON.parse(
  await readFile("src/manifest.template.json", "utf8"),
);
const version = await readPackageVersion();
const manifest = createPackagedManifest(manifestTemplate, version);

await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
