# Release Pipeline

Este projeto usa GitHub Actions para validar, empacotar e publicar a aplicação em três canais separados: stable, beta e nightly.

## Workflows

| Workflow | Ficheiro | Objetivo |
| --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Testa e faz build em Linux, macOS e Windows para PRs e `main`. |
| Release Please | `.github/workflows/release-please.yml` | Gera PRs de release, mantém `CHANGELOG.md` e aplica versões semânticas. |
| Release | `.github/workflows/release.yml` | Publica releases stable e beta a partir de tags SemVer. |
| Nightly | `.github/workflows/nightly.yml` | Publica uma prerelease `nightly` separada, agendada e manual. |
| Manual Windows Installer | `.github/workflows/windows-installer.yml` | Build manual de instaladores Windows quando for preciso testar isoladamente. |

## Canais

### Stable

Stable é publicado a partir de tags:

```text
v1.2.3
```

O workflow valida que `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e `.release-please-manifest.json` têm a mesma versão.

### Beta

Beta é publicado a partir de tags prerelease:

```text
v1.2.3-beta.1
```

O release no GitHub fica marcado como prerelease.

### Nightly

Nightly corre por agendamento e por `workflow_dispatch`.

O workflow move a tag `nightly` para o commit atual, substitui a prerelease `nightly` e publica novos artefactos. Este canal é intencionalmente instável.

## Changelog Automático

Release Please usa conventional commits para preparar uma PR de release.

Exemplos:

```text
feat: add repository health dashboard
fix: preserve focused worktree after refresh
docs: document Windows signing
```

Quando a PR é integrada, Release Please atualiza:

- `CHANGELOG.md`
- `package.json`
- `package-lock.json`
- `.release-please-manifest.json`

O script `npm run version:check` garante que a versão também está sincronizada com Tauri e Cargo.

## Artefactos

Os workflows de release fazem build em:

- `ubuntu-latest`
- `macos-latest`
- `windows-latest`

Artefactos esperados:

- Linux: `.AppImage`, `.deb`, `.rpm`
- macOS: `.dmg`
- Windows: `.exe`, `.msi`
- Checksums: `SHA256SUMS-*.txt`

## Assinatura E Provenance

O pipeline já inclui:

- Checksums SHA-256 para artefactos publicados.
- GitHub Artifact Attestations via `actions/attest-build-provenance`.
- Permissões OIDC (`id-token: write`) para provenance assinada por Sigstore.

Para assinatura nativa de aplicações, configurar estes segredos antes de uma release pública:

### Tauri updater

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### macOS code signing/notarization

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Windows code signing

Escolher um fornecedor de assinatura e guardar os segredos necessários no GitHub Actions. Exemplos comuns:

- Certificado PFX + password.
- Azure Trusted Signing.
- Serviço cloud HSM.

O workflow atual assina provenance e prepara a passagem de segredos Tauri. A assinatura nativa de Windows/macOS deve ser ligada quando os certificados existirem.

## Processo Recomendado

1. Trabalhar em branches normais e abrir PR.
2. Garantir CI verde nos três sistemas operativos.
3. Usar conventional commits.
4. Integrar a PR gerada por Release Please para criar a versão stable.
5. Para beta, criar uma tag `vX.Y.Z-beta.N`.
6. Verificar checksums, attestations e instaladores antes de anunciar a release.

## Comandos Locais

```bash
npm run version:check
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```
