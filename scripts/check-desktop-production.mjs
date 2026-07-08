import fs from "node:fs";

const errors = [];
const envDesktop = fs.existsSync(".env.desktop") ? fs.readFileSync(".env.desktop", "utf8") : "";
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const tauriDevConfig = readJson("src-tauri/tauri.dev.conf.json");
const packageJson = readJson("package.json");

if (!envDesktop.includes("VITE_DESKTOP_REQUIRE_TAURI=true")) {
  errors.push(".env.desktop must set VITE_DESKTOP_REQUIRE_TAURI=true.");
}

if (/^VITE_API_BASE_URL=/m.test(envDesktop)) {
  errors.push(".env.desktop must not configure VITE_API_BASE_URL; production desktop must use Tauri commands.");
}

const productionCsp = tauriConfig.app?.security?.csp ?? "";
const devCsp = tauriDevConfig.app?.security?.csp ?? "";
if (tauriConfig.build?.devUrl || tauriConfig.build?.beforeDevCommand) {
  errors.push("Production Tauri config must not define devUrl or beforeDevCommand.");
}

for (const forbidden of ["http://localhost", "http://127.0.0.1", "ws://"]) {
  if (productionCsp.includes(forbidden)) {
    errors.push(`Production CSP must not include ${forbidden}.`);
  }
}

for (const required of ["localhost:5173", "127.0.0.1:4174", "ws://localhost:5173"]) {
  if (!devCsp.includes(required)) {
    errors.push(`Development CSP should include ${required}.`);
  }
}

if (tauriDevConfig.build?.devUrl !== "http://localhost:5173") {
  errors.push("Development Tauri config must define devUrl for the local Vite server.");
}

if (!packageJson.scripts?.["desktop:dev"]?.includes("tauri.dev.conf.json")) {
  errors.push("desktop:dev must use src-tauri/tauri.dev.conf.json.");
}

if (!packageJson.scripts?.["build:desktop-ui"]?.includes("--mode desktop")) {
  errors.push("build:desktop-ui must use Vite desktop mode.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Production desktop hardening checks passed.");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
