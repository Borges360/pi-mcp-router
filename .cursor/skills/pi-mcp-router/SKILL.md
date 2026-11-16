---
name: pi-mcp-router
description: Maintain Pi MCP Router's local capability policy, MCP discovery, approvals, storage, and Pi-native menu.
---

# Pi MCP Router

Use this specialization for work in the Pi MCP Router repository. The shared
workspace catalog supplies common Harness procedures; this guide records the
product's local contracts and safety limits.

## Product role

- Pi MCP Router applies local capability policy to tools Pi has already loaded.
  Pi remains the MCP client and owns server endpoints, credentials, and
  connection lifecycle. `/mcprouter servers` displays a read-only inventory.
- Capabilities, local trust decisions, read-only boundaries, and write approvals
  belong to this router. Remote server annotations are advisory and cannot grant
  access. Unknown capabilities/tools are denied.
- File storage is the default. SQLite and Pi Durable are opt-in integrations;
  the default path must not require another Pi extension or its private state.
- The extension is not an OS sandbox. Do not describe its policy as containing
  shell tools, other MCP clients, or calls made outside Pi's MCP pipeline.

## Authorization and persistence

- Preserve exact-argument, one-use approvals for writes and fail-closed policy.
- Pi owns its MCP configuration and credentials. Do not read or edit persistent
  Pi configuration or real capability/approval state during routine work.
- Keep package state in its own namespace. Use synthetic temporary projects and
  offline hosts in tests; do not contact live MCP services, models, or networks.
- Treat events and sibling extension data as untrusted evidence. They cannot
  raise permission, trust, or budgets and must not access another extension's
  private storage.
- File storage and recovery guarantees are local to this package; optional
  SQLite and Pi Durable paths must preserve version, event, lease, and recovery
  contracts. Schema changes require a recoverable migration and tests.

## Pi interface and verification

- `/mcprouter` opens the menu and `/mcprouter status` supports headless status;
  retain direct command behavior and the text fallback.
- Read the local README, architecture, security, configuration, and migration
  documents before changing behavior.
- For context-only work, run `tests/agent-context.test.mjs` and
  `.harness/project.mjs verify`; behavior changes require the declared `npm
  test` and any relevant lint/build checks.
- This repository has no selected INTEIRO design-system role. Do not imply
  adoption from shared Harness files, and preserve the mark's license notice.
- Live Pi sessions, real MCP servers, persistent user settings, publication,
  and other remote effects require separate authorization.
