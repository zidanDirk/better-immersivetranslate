import { assertReleaseTag, readPackageVersion } from "./release-version.mjs";

const [tag] = process.argv.slice(2);
if (tag === undefined) {
  throw new Error("Usage: node scripts/validate-release.mjs <tag>");
}

const version = await readPackageVersion();
assertReleaseTag(tag, version);
console.log(`Validated release ${tag}.`);
