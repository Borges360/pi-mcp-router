# Storage migration

## MCP server configuration ownership

Pi now owns MCP endpoints, credentials, enablement and exposure. Configure them in
Pi's `~/.pi/agent/mcp.json` or `.pi/mcp.json`, or manage them with `/mcp`.
`/mcprouter servers` lists tools Pi has loaded into the current session. The
router's old `server-registry` records are retained but ignored; move any entries
you still need into Pi's MCP configuration. Existing router capability records
remain in place and continue to define local authorization policy.

Schema version 1 is the initial format. Future/unknown schemas fail closed without
resetting state. Downgrades are never automatic. Keep backups before upgrading.

```sh
node dist/cli.js storage status
node dist/cli.js storage migrate sqlite
node dist/cli.js storage migrate durable
node dist/cli.js storage migrate files
```

The slash-command equivalent is `/mcprouter storage migrate <backend>`.
Install optional Pi Durable 1.2.0 explicitly before choosing durable. File storage
does not load node:sqlite or Pi Durable. Merely installing a driver never switches
the active backend.

Migration serializes mutations, exports a versioned portable snapshot, imports to
a fresh destination directory, verifies logical record/event/blob hashes, seals
the source against subsequent writes, writes the backend pointer atomically and
checks destination health. Records and original source files are retained.
The destination becomes active in the current service and on future startups.
External effects are never reexecuted during migration.

A normal migration failure rolls the pointer and source seal back. Process death
after source sealing and before pointer replacement is recovered by checking the
migration owner's liveness and unsealing the old source. Process death after the
pointer replacement reopens the verified destination. A live or foreign migration
owner is never displaced. Tests kill actual processes at both boundaries. Corrupt
destinations fail closed and retain the source backup for explicit review. External
effects are never replayed by migration recovery. Pause active work before migration.
