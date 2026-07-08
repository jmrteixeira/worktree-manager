# Desktop Distribution

Este projeto tem uma primeira camada Tauri para evoluir a web app local para uma app desktop instalavel.

## Estado Atual

- `npm run desktop:dev` abre a app em Tauri e arranca o frontend/backend atuais com `npm run dev`.
- `npm run desktop:build` executa o build Tauri e usa `npm run build:desktop-ui` para gerar a UI com `VITE_API_BASE_URL=http://127.0.0.1:4174`.
- A build desktop ainda precisa de um backend local distribuivel: sidecar Node empacotado ou migração das operacoes Git para comandos Tauri/Rust.

## Requisitos Locais

- Node.js e npm.
- Rust toolchain com Cargo.
- Dependencias de sistema do Tauri para macOS, Windows ou Linux.

Se `cargo` ou `rustc` nao estiverem disponiveis, instalar Rust via rustup antes de correr os comandos Tauri.

## Comandos

```bash
npm run desktop:info
npm run desktop:dev
npm run desktop:build
npm run desktop:build:windows
```

## Artefactos macOS

Depois de `npm run desktop:build`, os artefactos principais ficam em:

- `src-tauri/target/release/bundle/macos/Worktree Manager.app`
- `src-tauri/target/release/bundle/dmg/Worktree Manager_1.0.0_aarch64.dmg`

## Pipeline De Release

O pipeline publico de release esta documentado em:

- `docs/release-pipeline.md`

Resumo:

- `ci.yml` valida PRs e `main` em Linux, macOS e Windows.
- `release-please.yml` prepara changelog e versoes semanticas.
- `release.yml` publica stable e beta por tags SemVer.
- `nightly.yml` publica a prerelease `nightly`.

## Artefactos Windows

O instalador Windows deve ser gerado num runner Windows. O caminho recomendado para releases publicas e usar `release.yml`. Para testes isolados, usar a workflow manual:

- `.github/workflows/windows-installer.yml`

No GitHub, abrir **Actions** -> **Manual Windows Installer** -> **Run workflow**. A workflow corre `npm run desktop:build:windows` em `windows-latest` e publica um artefacto chamado `worktree-manager-windows`.

Artefactos esperados:

- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`

A configuracao Windows vive em:

- `src-tauri/tauri.windows.conf.json`

Esta configuracao gera NSIS e MSI, embebe o bootstrapper WebView2 e deixa o instalador NSIS em modo `currentUser`, evitando privilegios de administrador por defeito.

Nota: instaladores Windows publicos devem ter assinatura nativa alem das attestations/checksums. Sem assinatura, o SmartScreen pode avisar os utilizadores, mesmo que o binario seja legitimo.

## Arquitetura Recomendada

Para uma release publica existem duas rotas aceitaveis:

1. **Backend nativo Tauri/Rust**
   - Migrar as operacoes Git para comandos Tauri.
   - Manter uma allowlist estrita de comandos e argumentos.
   - Evitar servidor HTTP local em producao.

2. **Sidecar local**
   - Empacotar o backend Node como binario sidecar.
   - Arrancar o sidecar no lifecycle da app.
   - Restringir o backend a `127.0.0.1` e validar origem/token local.

A rota nativa e a mais profissional a medio prazo. A rota sidecar e mais rapida porque reutiliza o backend atual.

## Release Blockers

- Trocar os icons gerados pelo Tauri por assets finais da marca.
- Implementar sidecar ou backend nativo.
- Configurar assinatura nativa Windows/macOS.
- Configurar updater assinado.
- Testar instaladores em maquinas limpas.

## Referencias

- Tauri updater e assinatura: https://v2.tauri.app/plugin/updater/
- Tauri distribuicao: https://v2.tauri.app/distribute/
- Git worktree: https://git-scm.com/docs/git-worktree
- Git status porcelain v2: https://git-scm.com/docs/git-status
