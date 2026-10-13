import test from "node:test";
import assert from "node:assert/strict";
import {
  routeCapabilities,
  approvalValid,
  validateCapability,
} from "../dist/mcp.js";
import { digest } from "../dist/common/security.js";
const candidate = (server, name, readOnly = true) => ({
  server,
  name,
  readOnly,
  destructive: !readOnly,
  openWorld: !readOnly,
  trusted: true,
  available: true,
});
const cap = (id, candidates) => ({
  schemaVersion: 1,
  id,
  description: id,
  keywords: [id],
  allowed: true,
  candidates,
});
test("capability routing defaults to deny and respects tool/server limits", () => {
  const catalog = [
    cap("issue.read", [candidate("github", "mcp__github__read")]),
    cap("db.read", [candidate("db", "mcp__db__read")]),
    cap("search", [candidate("search", "mcp__search__find")]),
  ];
  const d = routeCapabilities(
    ["unknown", ...catalog.map((c) => c.id)],
    catalog,
    { maxServers: 2, maxTools: 2 },
  );
  assert.equal(d.tools.length, 2);
  assert.equal(d.servers.length, 2);
  assert.ok(d.denied.some((c) => c.capability === "unknown"));
  assert.ok(d.denied.some((c) => c.reason === "surface-limit"));
});
test("local trust wins over malicious annotations and colliding names remain server-qualified", () => {
  const d = routeCapabilities(
    ["unsafe", "safe"],
    [
      cap("unsafe", [
        {
          ...candidate("evil", "mcp__evil__read"),
          trusted: false,
          annotations: { readOnlyHint: true },
        },
      ]),
      cap("safe", [
        candidate("a", "mcp__a__read"),
        candidate("b", "mcp__b__read"),
      ]),
    ],
    { maxServers: 2, maxTools: 12 },
  );
  assert.equal(d.tools.length, 1);
  assert.ok(!d.tools.includes("mcp__evil__read"));
  assert.ok(d.denied.some((c) => c.reason === "unavailable-or-untrusted"));
});
test("approvals bind exact arguments, task, server, expiration and single use", () => {
  const args = { id: 1 };
  const approval = {
    schemaVersion: 1,
    id: "a",
    tool: "write",
    server: "github",
    taskId: "task",
    argumentsHash: digest(args),
    expiresAt: Date.now() + 10000,
    consumed: false,
  };
  assert.equal(approvalValid(approval, "write", "github", "task", args), true);
  for (const a of [
    { ...approval, consumed: true },
    { ...approval, expiresAt: 0 },
    { ...approval, taskId: "other" },
    { ...approval, argumentsHash: digest({ id: 2 }) },
  ])
    assert.equal(approvalValid(a, "write", "github", "task", args), false);
  assert.throws(
    () =>
      validateCapability({
        schemaVersion: 1,
        id: "unsafe",
        allowed: true,
        candidates: [],
      }),
    /invalid/,
  );
});
