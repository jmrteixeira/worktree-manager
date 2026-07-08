import fs from "node:fs";

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const manifest = fs.existsSync(".release-please-manifest.json")
  ? readJson(".release-please-manifest.json")
  : null;

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  "package.json": packageJson.version,
  "package-lock.json": packageLock.packages?.[""]?.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
  ...(manifest ? { ".release-please-manifest.json": manifest["."] } : {})
};

const errors = [];

for (const [file, version] of Object.entries(versions)) {
  if (!version) {
    errors.push(`${file} does not expose a version.`);
    continue;
  }
  if (!semverPattern.test(version)) {
    errors.push(`${file} version "${version}" is not valid SemVer.`);
  }
}

const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size > 1) {
  errors.push(`Version mismatch: ${JSON.stringify(versions, null, 2)}`);
}

const expectedVersion = process.env.RELEASE_VERSION ?? versionFromGitHubRef();
if (expectedVersion && packageJson.version !== expectedVersion) {
  errors.push(`Release version ${expectedVersion} does not match package version ${packageJson.version}.`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Version ${packageJson.version} is valid and synchronized.`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function versionFromGitHubRef() {
  if (process.env.GITHUB_REF_TYPE !== "tag") return null;
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag?.startsWith("v")) return null;
  return tag.slice(1);
}
