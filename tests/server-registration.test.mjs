import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../dist/common/runtime.js";
import { localBus } from "../dist/common/cli.js";
import { createService, normalizeServerRegistration } from "../dist/mcp.js";
test("server credentials are resolved only in memory and environment references survive redaction and restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-registration-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  process.env.MCP_TEST_CREDENTIAL = "test-credential-value";
  const registrations = [];
  const api = {
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    registerMcpServer: (name, config) => registrations.push({ name, config }),
    unregisterMcpServer: () => {},
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
    delete process.env.MCP_TEST_CREDENTIAL;
  });
  await writeFile(
    join(root, "server.json"),
    JSON.stringify({
      id: "github",
      url: "https://example.test/mcp",
      headerEnv: [
        {
          header: "Authorization",
          variable: "MCP_TEST_CREDENTIAL",
          prefix: "Bearer ",
        },
      ],
    }),
  );
  await host.command("servers", ["add", "server.json"], {
    cwd: root,
    trusted: false,
  });
  assert.equal(
    registrations.at(-1).config.headers.Authorization,
    "Bearer test-credential-value",
  );
  const persisted = await host.store.getRecord("server-registry", "github");
  assert.equal(persisted.headerEnv[0].variable, "MCP_TEST_CREDENTIAL");
  assert.ok(
    !JSON.stringify(await host.store.exportSnapshot()).includes(
      "test-credential-value",
    ),
  );
  await host.close();
  await host.start();
  assert.equal(
    registrations.at(-1).config.headers.Authorization,
    "Bearer test-credential-value",
  );
});
test("server URLs cannot persist embedded or query-string secrets", () => {
  for (const url of [
    "https://user:password@example.test/mcp",
    "https://example.test/mcp?api_key=value",
    "ftp://example.test/mcp",
  ])
    assert.throws(
      () => normalizeServerRegistration({ id: "server", url }),
      /credentials/,
    );
  assert.deepEqual(
    normalizeServerRegistration({
      id: "server",
      url: "https://example.test/mcp",
      headerEnv: { Authorization: "MCP_TEST_CREDENTIAL" },
    }).headerEnv,
    [{ header: "Authorization", variable: "MCP_TEST_CREDENTIAL" }],
  );
});
