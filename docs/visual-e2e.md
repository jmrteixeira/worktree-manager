# E2E Visual

Use `?visual=1` para correr a aplicação com dados estáveis e independentes de repositórios reais.

## URLs

- Dashboard: `http://localhost:5173/?visual=1#dashboard`
- Detalhe: `http://localhost:5173/?visual=1#detail`
- Worktrees: `http://localhost:5173/?visual=1#worktrees`
- Branches: `http://localhost:5173/?visual=1#branches`
- Operações: `http://localhost:5173/?visual=1#operations`
- Ajuda: `http://localhost:5173/?visual=1#help`
- Dados e privacidade: `http://localhost:5173/?visual=1#privacy`
- Configurações: `http://localhost:5173/?visual=1#settings`

## Viewports

- Desktop: `1440x1100`
- Mobile: `390x844`

## Checklist

- A navegação lateral não sobrepõe o conteúdo.
- Os cartões e badges não cortam texto essencial.
- As tabelas têm scroll horizontal quando necessário.
- Os menus de ações abrem fora da grelha e fecham ao clicar fora.
- Modais mantêm foco, scroll e botões visíveis.
- Tema claro/escuro/sistema não cria contraste fraco.

## Saída Recomendada

Guardar screenshots em `artifacts/visual-e2e/`, que fica fora do controlo de versão.

Quando a sidebar sticky está visível, preferir screenshots de viewport para páginas longas. Screenshots full-page podem recompor elementos sticky de forma diferente do que o utilizador vê.

Artefactos usados nesta validação:

- `dashboard-desktop.png`
- `worktrees-menu-desktop.png`
- `detail-desktop.png`
- `branches-desktop.png`
- `operations-expanded-desktop.png`
- `help-desktop.png`
- `privacy-desktop.png`
- `settings-light-desktop.png`
- `dashboard-mobile.png`
- `worktrees-mobile.png`
