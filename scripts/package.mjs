import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { readPackageVersion } from "./release-version.mjs";

const version = await readPackageVersion();
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

if (manifest.version !== version) {
  throw new Error(
    `Built manifest version "${manifest.version}" does not match package version "${version}".`,
  );
}

await rm("release", { force: true, recursive: true });
await mkdir("release", { recursive: true });

const archiveName = `better-immersivetranslate-v${version}.zip`;
const archivePath = resolve("release", archiveName);
const zipProcess = spawn("zip", ["-q", "-r", archivePath, "."], {
  cwd: "dist",
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExitCode, reject) => {
  zipProcess.once("error", reject);
  zipProcess.once("close", resolveExitCode);
});

if (exitCode !== 0) {
  throw new Error(`zip exited with code ${exitCode}.`);
}

console.log(archivePath);
