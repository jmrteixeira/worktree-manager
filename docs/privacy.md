# Dados E Privacidade

Worktree Manager e uma ferramenta local-first. A regra base e simples: nada sai da maquina sem uma acao explicita do utilizador.

## Telemetria

Nao existe telemetria remota implementada.

A aplicacao nao envia automaticamente:

- metricas de uso;
- eventos de UI;
- erros;
- nomes de repositorios;
- caminhos locais;
- branches;
- comandos Git;
- stdout/stderr;
- diagnosticos.

Se no futuro existir telemetria, deve ser:

- desligada por defeito;
- ativada apenas por opt-in claro;
- descrita numa pagina de privacidade;
- auditavel no historico local;
- facil de desligar.

## Dados Guardados Localmente

A app pode guardar dados no ficheiro local de estado e no `localStorage` do browser/webview.

Exemplos:

- repositorios recentes;
- timestamps de abertura;
- preferencias como tema, idioma, modo seguro e integracoes;
- historico local recente de operacoes Git;
- worktrees em foco por repositorio;
- estado visual como onboarding dispensado.

O caminho do ficheiro de estado aparece na pagina **Dados e privacidade** e no painel de diagnostico local.

## Acoes Que Podem Contactar Sistemas Externos

Algumas acoes iniciadas pelo utilizador podem contactar sistemas fora da app:

- `fetch` e `pull` comunicam com os remotos Git configurados no repositorio.
- Abrir editor, terminal ou pasta delega a acao ao sistema operativo.
- Copiar diagnostico ou relatorio escreve dados na area de transferencia local.

A app nao envia esses dados para um servico proprio.

## Diagnosticos

Diagnosticos sao gerados localmente. O botao para copiar JSON coloca os dados na area de transferencia; o utilizador decide se, quando e onde partilhar.

Antes de partilhar diagnosticos publicamente, rever e remover:

- caminhos privados;
- nomes de repositorios privados;
- branches sensiveis;
- mensagens de erro com informacao interna;
- stdout/stderr que possa conter segredos.
