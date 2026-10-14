import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../dist/common/runtime.js";
import { localBus } from "../dist/common/cli.js";
import { createService, McpRouter } from "../dist/mcp.js";

const context = (cwd) => ({ cwd, trusted: false });

test("servers are discovered from Pi's MCP tool inventory and are read-only", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-discovery-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  const allTools = [
    {
      name: "mcp__github__search_issues",
      exposure: "deferred",
      namespace: { name: "mcp__github", aliases: ["github"] },
    },
    {
      name: "mcp__local_docs__search",
      exposure: "direct",
      namespace: { name: "mcp__local_docs", aliases: ["local-docs"] },
    },
  ];
  const api = {
    getActiveTools: () => [],
    getAllTools: () => allTools,
    setActiveTools: () => {},
    registerMcpServer: () => assert.fail("router must not register servers"),
    unregisterMcpServer: () =>
      assert.fail("router must not unregister servers"),
  };
  const host = new Host(
    "pi-mcp-router",
    createService,
    root,
    localBus(),
    false,
    api,
  );
  await host.start();
  t.after(async () => {
    await host.close();
    await rm(root, { recursive: true, force: true });
    delete process.env.PI_ECOSYSTEM_STATE_ROOT;
  });

  const inventory = await host.command("servers", [], context(root));
  assert.equal(inventory.source, "Pi session MCP tools");
  assert.deepEqual(
    inventory.servers.map((server) => server.name),
    ["github", "local-docs"],
  );
  assert.deepEqual(inventory.servers[0].tools, [
    { name: "mcp__github__search_issues", exposure: "deferred" },
  ]);
  await assert.rejects(
    host.command("servers", ["add", "server.json"], context(root)),
    /servers-is-read-only/,
  );
  assert.equal(await host.store.getRecord("server-registry", "github"), null);
});

test("capabilities match discovered Pi server namespaces and ignore hidden tools", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-policy-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  const api = {
    getActiveTools: () => [],
    getAllTools: () => [
      {
        name: "mcp__github__search_issues",
        exposure: "direct",
        namespace: { name: "mcp__github", aliases: ["github"] },
      },
      {
        name: "mcp__github__delete_issue",
        exposure: "hidden",
        namespace: { name: "mcp__github", aliases: ["github"] },
      },
      {
        name: "mcp__other__read",
        exposure: "direct",
        namespace: { name: "mcp__other", aliases: ["other"] },
      },
    ],
    setActiveTools: () => {},
  };
  const host = new Host(
    "pi-mcp-router",
    createService,
    root,
    localBus(),
    false,
    api,
  );
  await host.start();
  t.after(async () => {
    await host.close();
    await rm(root, { recursive: true, force: true });
    delete process.env.PI_ECOSYSTEM_STATE_ROOT;
  });

  const router = host.service;
  assert.ok(router instanceof McpRouter);
  router.catalog = [
    {
      schemaVersion: 1,
      id: "issue.search",
      description: "Search GitHub issues",
      keywords: ["issue"],
      allowed: true,
      candidates: [
        {
          server: "github",
          name: "mcp__github__search_issues",
          readOnly: true,
          destructive: false,
          openWorld: false,
          trusted: true,
          available: false,
        },
        {
          server: "other",
          name: "mcp__github__search_issues",
          readOnly: true,
          destructive: false,
          openWorld: false,
          trusted: true,
          available: false,
        },
        {
          server: "github",
          name: "mcp__github__delete_issue",
          readOnly: false,
          destructive: true,
          openWorld: false,
          trusted: true,
          available: true,
        },
      ],
    },
  ];
  router.refresh();
  assert.equal(router.catalog[0].candidates[0].available, true);
  assert.equal(router.catalog[0].candidates[1].available, false);
  assert.equal(router.catalog[0].candidates[2].available, false);
});

test("legacy server registrations are retained and reported for migration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-legacy-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  const host = new Host(
    "pi-mcp-router",
    createService,
    root,
    localBus(),
    false,
    {
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools: () => {},
    },
  );
  await host.start();
  await host.store.putRecord("server-registry", "old-github", {
    id: "old-github",
    url: "https://example.test/mcp",
    headerEnv: [],
  });
  await host.close();
  await host.start();
  t.after(async () => {
    await host.close();
    await rm(root, { recursive: true, force: true });
    delete process.env.PI_ECOSYSTEM_STATE_ROOT;
  });

  const inventory = await host.command("servers", [], context(root));
  assert.equal(inventory.legacyRegistrations, 1);
  assert.match(inventory.migration, /Pi's mcp\.json/);
  assert.equal(
    await host.store.getRecord("server-registry", "old-github").then(Boolean),
    true,
  );
});
