import { readFile } from "node:fs/promises";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertStableVersion(version) {
  if (!STABLE_VERSION_PATTERN.test(version)) {
    throw new Error(
      `Version "${version}" must use stable MAJOR.MINOR.PATCH format.`,
    );
  }

  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65_535) || parts.every((part) => part === 0)) {
    throw new Error(
      `Version "${version}" must satisfy Chrome's numeric version limits.`,
    );
  }
}

export function assertReleaseTag(tag, version) {
  assertStableVersion(version);

  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(
      `Release tag "${tag}" must exactly match package version "${expectedTag}".`,
    );
  }
}

export function createPackagedManifest(manifestTemplate, version) {
  assertStableVersion(version);

  if (
    manifestTemplate === null ||
    Array.isArray(manifestTemplate) ||
    typeof manifestTemplate !== "object"
  ) {
    throw new Error("Manifest template must be a JSON object.");
  }

  return { ...manifestTemplate, version };
}

export async function readPackageVersion(packagePath = "package.json") {
  const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof packageMetadata.version !== "string") {
    throw new Error(`Package file "${packagePath}" has no string version.`);
  }

  assertStableVersion(packageMetadata.version);
  return packageMetadata.version;
}
