import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../dist/common/runtime.js";
import { localBus } from "../dist/common/cli.js";
import { createService } from "../dist/mcp.js";
test("MCP task negotiation persists handles and never replays uncertain submission", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-task-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  const host = new Host("pi-mcp-router", createService, root, localBus());
  await host.start();
  t.after(async () => {
    await host.close();
    await rm(root, { recursive: true, force: true });
    delete process.env.PI_ECOSYSTEM_STATE_ROOT;
  });
  let calls = 0;
  const adapter = {
    supportsTasks: true,
    submit: async () => {
      calls++;
      return { taskId: "remote-1", status: "working" };
    },
    poll: async () => ({ status: "working" }),
  };
  const first = await host.service.durable(adapter, "read", {});
  assert.equal(first.pending, true);
  await host.service.durable(adapter, "read", {});
  assert.equal(calls, 1);
  let polls = 0;
  const completing = {
    ...adapter,
    poll: async () => {
      polls++;
      return {
        status: "completed",
        result: { summary: "done", token: "sensitive" },
      };
    },
  };
  const terminal = await host.service.pollDurable(completing, "read", {});
  assert.equal(terminal.status, "completed");
  assert.ok(terminal.evidenceRef);
  const output = Buffer.from(
    await host.store.readBlob(terminal.evidenceRef),
  ).toString();
  assert.equal(output.includes("sensitive"), false);
  assert.equal(
    (await host.service.pollDurable(completing, "read", {})).status,
    "completed",
  );
  assert.equal(polls, 1);
  assert.equal(calls, 1);
  await assert.rejects(
    host.service.durable({ ...adapter, supportsTasks: false }, "read", {}),
    /unsupported/,
  );
  const uncertain = {
    ...adapter,
    submit: async () => {
      calls++;
      throw new Error("disconnect-after-submit");
    },
  };
  await assert.rejects(
    host.service.durable(uncertain, "deploy", {}),
    /disconnect/,
  );
  await assert.rejects(
    host.service.durable(uncertain, "deploy", {}),
    /side-effect-review/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    host.service.pollDurable(adapter, "deploy", {}),
    /handle-required/,
  );
  await host.service.durable(adapter, "inspect", { path: "next" });
  await assert.rejects(
    host.service.pollDurable(
      {
        ...adapter,
        poll: async () => {
          throw new Error("poll-disconnect");
        },
      },
      "inspect",
      { path: "next" },
    ),
    /poll-disconnect/,
  );
  assert.equal(
    (await host.service.pollDurable(adapter, "inspect", { path: "next" }))
      .status,
    "working",
  );
  assert.equal(calls, 3);
});
