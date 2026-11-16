# Pi MCP Router

Local capability and permission routing for MCP tools available to Pi.

**Package:** `@borges360/pi-mcp-router` · **version:** `0.1.3`

**Status:** development release. Install instructions below use the Git repository. npm registry availability and publication have not been verified; package metadata does not prove registry availability.

**Compatibility:** Node.js `>=22.19.0`. The development loader test targets Pi SDK `1.2.0`. A separate offline Pi `1.4.0` RPC smoke exercised the registered `0.1.2` cache, not this `0.1.3` checkout; it does not establish broader host compatibility.

## English

### What it does

Pi MCP Router exposes a local capability policy over MCP tools that Pi has loaded. Tasks select capabilities rather than provider-specific names. It selects only locally authorized trusted candidates, with two servers and twelve direct tools by default. Exact-argument, one-use approvals protect writes; annotations from a remote server cannot grant access.

The default backend is local file storage. SQLite and Pi Durable are opt-in. The default path does not require a sibling extension, SQLite driver, remote classifier, or Durable installation.

### Install

The repository's Pi Git install path is:

~~~sh
pi install git:github.com/Borges360/pi-mcp-router
~~~

This installs from Git; it is not an npm registry installation. Registry availability remains unverified until CT59.

For local development, install the locked dependencies and run the checks:

~~~sh
npm ci
npm run build
npm run lint
npm test
npm run benchmark
npm pack --dry-run
~~~

Pi loads `src/extension.ts`. The package also contains the `pi-mcp-router` CLI at `dist/cli.js`.

### Use

Run `/mcprouter` to open the interactive menu or `/mcprouter status` for structured headless status. Domain actions include `capabilities`, `servers`, `tools`, `explain`, `route <capability...>`, `check <capability...>`, and `approve <approval.json>`. Shared actions include `auto`, `off`, `observe`, `config`, `doctor`, `storage status`, and `storage migrate files|sqlite|durable`.

The CLI accepts the same actions; for example:

~~~sh
node dist/cli.js status
node dist/cli.js doctor
~~~

The menu groups **Capabilities**, **Servers**, **Tools**, and **Settings**. Escape in a group returns to the categories; Escape in the categories closes the menu. **Settings → config** opens the mode panel; **Settings → language** opens the language selector. Enter previews a mode or language draft, Ctrl+S saves it, and Escape returns to Settings. A language preference is saved only for the current trusted project in `.pi/pi-mcp-router.locale.json`; untrusted projects remain in English. The CLI action names remain unchanged. Headless config returns validated settings. Advanced settings can be edited in the user config.

Pi owns MCP server configuration and connections. Configure endpoints, credentials, and exposure in Pi's `mcp.json` or `/mcp`. `/mcprouter servers` is a read-only inventory of MCP tools loaded in the Pi session. Disconnected, disabled, or empty servers may not appear until Pi loads their tools.

### Configuration and state

Default state is `~/.pi/agent/state/pi-mcp-router/projects/<sha256-of-canonical-repository-root>/`. `PI_ECOSYSTEM_STATE_ROOT` changes the parent directory for testing or deployment. No project state is written implicitly.

### Language

This README is provided in English and Brazilian Portuguese. The `/mcprouter` dashboard starts in English and offers **Settings → language** for Brazilian Portuguese. Enter previews a language draft, Ctrl+S saves it in the current trusted project's `.pi/pi-mcp-router.locale.json`, and Escape warns before discarding an unsaved draft. Untrusted projects remain in English. CLI action names are unchanged.

### Privacy and security

Local policy, bounded actions, optimistic record versions, checksums, an append-only journal, and fail-closed persistence protect router state. Secrets are redacted at output boundaries, but heuristics cannot detect every arbitrary secret. Do not place secrets in MCP tool calls or capability data. Pi remains responsible for MCP server configuration, credentials, and connections.

### Troubleshooting and limits

Start with `node dist/cli.js doctor` and `node dist/cli.js status`. See [architecture](ARCHITECTURE.md), [configuration](CONFIGURATION.md), [security](SECURITY.md), [migration](MIGRATION.md), [compatibility](COMPATIBILITY.md), [benchmarks](benchmarks/README.md), and [acceptance status](ACCEPTANCE.md).

Local correctness and recovery results do not establish SWE-bench or Terminal-Bench quality, model quality, or inference-cost savings. No external MCP endpoint is required for the documented local checks.

### License

The software is licensed under MIT; see [LICENSE](LICENSE). The INTEIRO mark has separate attribution and licensing terms in [its notice](docs/assets/INTEIRO-MARK-LICENSE.txt).

## Português (Brasil)

### O que faz

O Pi MCP Router aplica uma política local de capacidades às ferramentas MCP carregadas pelo Pi. As tarefas selecionam capacidades, não nomes específicos de provedores. A seleção considera apenas candidatos confiáveis e autorizados localmente, com dois servidores e doze ferramentas diretas por padrão. Aprovações de uso único vinculadas aos argumentos exatos protegem gravações; anotações de servidores remotos não concedem acesso.

O backend padrão usa arquivos locais. SQLite e Pi Durable são opcionais. O caminho padrão não exige extensão irmã, driver SQLite, classificador remoto ou instalação do Durable.

### Instalação

O caminho de instalação Git no Pi é:

~~~sh
pi install git:github.com/Borges360/pi-mcp-router
~~~

Essa instalação usa Git; não é uma instalação pelo registry npm. A disponibilidade e publicação no registry continuam sem verificação até CT59.

Para desenvolvimento local, instale as dependências bloqueadas e execute as verificações:

~~~sh
npm ci
npm run build
npm run lint
npm test
npm run benchmark
npm pack --dry-run
~~~

O Pi carrega `src/extension.ts`. O pacote também contém o CLI `pi-mcp-router` em `dist/cli.js`.

### Uso

Execute `/mcprouter` para abrir o menu interativo ou `/mcprouter status` para obter status estruturado sem interface. Ações específicas incluem `capabilities`, `servers`, `tools`, `explain`, `route <capability...>`, `check <capability...>` e `approve <approval.json>`. Ações compartilhadas incluem `auto`, `off`, `observe`, `config`, `doctor`, `storage status` e `storage migrate files|sqlite|durable`.

O CLI aceita as mesmas ações. Por exemplo:

~~~sh
node dist/cli.js status
node dist/cli.js doctor
~~~

O menu agrupa **Capabilities**, **Servers**, **Tools** e **Configurações**. Escape em um grupo volta às categorias; Escape nas categorias fecha o menu. **Configurações → configuração** abre o painel de modo e **Configurações → idioma** abre o seletor. Enter pré-visualiza um rascunho de modo ou idioma, Ctrl+S salva e Escape volta às Configurações. A preferência de idioma é salva somente no projeto confiável atual, em `.pi/pi-mcp-router.locale.json`; projetos não confiáveis permanecem em inglês. Os nomes das ações do CLI não mudam. A configuração sem interface retorna opções validadas; configurações avançadas podem ser editadas no arquivo do usuário.

O Pi administra a configuração e as conexões dos servidores MCP. Configure endpoints, credenciais e exposição no `mcp.json` do Pi ou em `/mcp`. `/mcprouter servers` apenas lista as ferramentas MCP carregadas na sessão do Pi. Servidores desconectados, desativados ou vazios podem não aparecer até o Pi carregar suas ferramentas.

### Configuração e estado

O estado padrão fica em `~/.pi/agent/state/pi-mcp-router/projects/<sha256-of-canonical-repository-root>/`. `PI_ECOSYSTEM_STATE_ROOT` altera o diretório pai para testes ou implantação. O estado do projeto não é gravado implicitamente.

### Idioma

Este README está em inglês e português brasileiro. O painel `/mcprouter` inicia em inglês e oferece **Configurações → idioma** para português brasileiro. Enter pré-visualiza o rascunho, Ctrl+S salva a preferência em `.pi/pi-mcp-router.locale.json` no projeto confiável atual e Escape avisa antes de descartar um rascunho não salvo. Projetos não confiáveis permanecem em inglês. Os nomes das ações do CLI não mudam.

### Privacidade e segurança

Política local, ações limitadas, versões otimistas de registros, checksums, journal append-only e persistência fail-closed protegem o estado do roteador. Segredos são redigidos nas saídas, mas heurísticas não detectam todo segredo arbitrário. Não inclua segredos em chamadas de ferramentas MCP nem em dados de capacidades. O Pi continua responsável pela configuração, credenciais e conexões dos servidores MCP.

### Diagnóstico e limites

Comece por `node dist/cli.js doctor` e `node dist/cli.js status`. Consulte [arquitetura](ARCHITECTURE.md), [configuração](CONFIGURATION.md), [segurança](SECURITY.md), [migração](MIGRATION.md), [compatibilidade](COMPATIBILITY.md), [benchmarks](benchmarks/README.md) e [status de aceite](ACCEPTANCE.md).

Os resultados locais de correção e recuperação não comprovam qualidade em SWE-bench ou Terminal-Bench, qualidade do modelo nem redução do custo de inferência. As verificações locais documentadas não exigem endpoint MCP externo.

### Licença

O software usa a licença MIT; consulte [LICENSE](LICENSE). A marca INTEIRO tem atribuição e licença separadas, descritas em [seu aviso](docs/assets/INTEIRO-MARK-LICENSE.txt).
