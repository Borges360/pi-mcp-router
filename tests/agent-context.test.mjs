import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("product context describes MCP ownership and the router's fail-closed boundary", async () => {
  const agents = await read("../AGENTS.md");
  const skill = await read("../.agents/skills/pi-mcp-router/SKILL.md");

  assert.match(agents, /The router applies local capability and approval policy/);
  assert.match(skill, /Pi remains the MCP client and owns server endpoints, credentials/);
  assert.match(skill, /Unknown capabilities\/tools are denied/);
  assert.match(skill, /not an OS sandbox/);
  assert.match(skill, /no selected INTEIRO design-system role/);
});

test("Pi and Cursor specializations and metadata stay byte-identical", async () => {
  const [piSkill, cursorSkill, piMetadata, cursorMetadata] = await Promise.all([
    read("../.agents/skills/pi-mcp-router/SKILL.md"),
    read("../.cursor/skills/pi-mcp-router/SKILL.md"),
    read("../.agents/skills/pi-mcp-router/metadata.yaml"),
    read("../.cursor/skills/pi-mcp-router/metadata.yaml"),
  ]);

  assert.equal(piSkill, cursorSkill);
  assert.equal(piMetadata, cursorMetadata);
  assert.match(piMetadata, /id: pi-mcp-router/);
  assert.match(piMetadata, /scope: "product-local; Pi, Codex and Cursor"/);
});
