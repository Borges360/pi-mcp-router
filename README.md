# pi-mcp-router

Minimal MCP capabilities with a local permission policy.

Tasks select capabilities rather than provider-specific names. Only locally authorized trusted candidates are selected, with two servers and twelve direct tools by default. Exact-argument one-use approvals protect writes; remote annotations cannot grant access.

## Install

Requires Node >= 22.19 and Pi **1.2.0**. Install this Git repository with Pi:

```sh
pi install git:github.com/Borges360/pi-mcp-router
```

From a local checkout:

```sh
npm ci
npm test
npm run build
pi -e ./src/extension.ts
node dist/cli.js doctor
```

The source entry point is loadable directly by Pi; npm packages include source and
compiled JavaScript/declarations. No sibling extension, SQLite driver, remote
classifier or Durable installation is required for the default file backend.

## Use

Run `/mcprouter` for the interactive menu, or `/mcprouter status` for structured
headless output. Domain actions: `status, capabilities [add <json>], servers, tools, explain, route <capability...>, check <capability...>, approve <approval.json>`. Shared actions: `auto`, `off`,
`observe`, `config`, `doctor`, `storage status`, `storage migrate files|sqlite|durable`.
The CLI uses the same actions: `node dist/cli.js status`.
TUI groups: Capabilities / Servers / Tools / Settings. Press Escape in a group
to return to the categories; Escape in the categories closes the menu. Settings
**config** opens a centered mode panel showing the current mode and a short
explanation of each option. Use the arrow keys to choose, Enter to save, and
Escape to return to Settings. Headless config returns validated settings. Edit
the user config for advanced settings.

Pi owns MCP server configuration and connections. Configure endpoints, credentials
and exposure in Pi's `mcp.json` or `/mcp`; `/mcprouter servers` is a read-only
inventory of MCP tools currently loaded in the Pi session. The router stores only
its local capability and permission policies. Disconnected, disabled or empty
servers may not appear until Pi loads their tools.

Default state: `~/.pi/agent/state/pi-mcp-router/projects/<sha256-of-canonical-repository-root>/`.
`PI_ECOSYSTEM_STATE_ROOT` changes the parent state directory for testing or deployment.
No project state is written implicitly.

## Guarantees and validation

Versioned optional events, bounded actions, optimistic record versions, secret
redaction at output boundaries, checksum validation, append-only journal and
fail-closed persistence. The same storage conformance tests run against files,
SQLite and pinned Pi Durable 1.2.0. Fault tests kill a real process after a durable
journal commit, race two processes and reject corrupt snapshots or symlink escapes.

```sh
npm test
npm run lint
npm run benchmark
npm pack --dry-run
```

This is a development release. Local correctness/recovery results do not establish
SWE-bench/Terminal-Bench quality or inference-cost savings. See [benchmarks](benchmarks/README.md)
and [acceptance status](ACCEPTANCE.md) for the limits of the evidence.

[Architecture](ARCHITECTURE.md) · [Configuration](CONFIGURATION.md) ·
[Security](SECURITY.md) · [Migration](MIGRATION.md) · [Compatibility](COMPATIBILITY.md).

Git checkouts include the compiled worker and CLI. CI checks that a rebuild matches
the committed distribution. Host-provided Pi packages, including the coding-agent SDK
and Typebox, are declared as peer dependencies. Isolated child workers resolve the SDK
from the active Pi installation.
