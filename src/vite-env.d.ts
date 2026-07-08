/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DESKTOP_REQUIRE_TAURI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
