import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const bundleDir = process.argv[2] ?? "src-tauri/target/release/bundle";
const outputFile = process.argv[3] ?? `dist/checksums/SHA256SUMS-${process.platform}.txt`;
const allowedExtensions = new Set([
  ".appimage",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
  ".rpm",
  ".sig",
  ".zip"
]);

const files = (await listFiles(bundleDir))
  .filter((file) => shouldHash(file))
  .sort((left, right) => left.localeCompare(right));

if (!files.length && process.env.ALLOW_EMPTY_CHECKSUMS !== "true") {
  console.error(`No release artifacts found under ${bundleDir}.`);
  process.exit(1);
}

const lines = [];
for (const file of files) {
  const buffer = await fs.readFile(file);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  lines.push(`${hash}  ${path.relative(process.cwd(), file).replace(/\\/g, "/")}`);
}

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
console.log(`Wrote ${lines.length} checksum(s) to ${outputFile}.`);

async function listFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldHash(file) {
  const lower = file.toLowerCase();
  return allowedExtensions.has(path.extname(lower)) || lower.endsWith(".tar.gz");
}
