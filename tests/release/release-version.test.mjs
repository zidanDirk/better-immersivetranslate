import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReleaseTag,
  assertStableVersion,
  createPackagedManifest,
} from "../../scripts/release-version.mjs";

test("accepts stable three-part versions", () => {
  assert.doesNotThrow(() => assertStableVersion("0.1.0"));
  assert.doesNotThrow(() => assertStableVersion("12.34.56"));
});

test("rejects prerelease and ambiguous versions", () => {
  for (const version of [
    "v0.1.0",
    "0.1",
    "0.1.0-beta.1",
    "01.2.3",
    "0.0.0",
    "65536.0.0",
  ]) {
    assert.throws(() => assertStableVersion(version));
  }
});

test("requires the release tag to exactly match the package version", () => {
  assert.doesNotThrow(() => assertReleaseTag("v0.1.0", "0.1.0"));
  assert.throws(() => assertReleaseTag("v0.1.1", "0.1.0"));
  assert.throws(() => assertReleaseTag("0.1.0", "0.1.0"));
});

test("adds the package version without mutating the manifest template", () => {
  const template = { manifest_version: 3, name: "Example" };
  const manifest = createPackagedManifest(template, "0.1.0");

  assert.deepEqual(manifest, {
    manifest_version: 3,
    name: "Example",
    version: "0.1.0",
  });
  assert.deepEqual(template, { manifest_version: 3, name: "Example" });
});
