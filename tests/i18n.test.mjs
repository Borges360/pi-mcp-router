import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogs,
  localePreferencePath,
  locales,
  menuText,
  readProjectLocale,
  translate,
  writeProjectLocale,
} from "../dist/common/i18n.js";

test("English and pt-BR catalogs have matching keys and placeholders", () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs["pt-BR"]).sort());
  for (const key of Object.keys(catalogs.en)) {
    const placeholders = (value) => [...value.matchAll(/\{([a-zA-Z0-9]+)\}/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(
      placeholders(catalogs["pt-BR"][key]),
      placeholders(catalogs.en[key]),
      `${key} placeholder parity`,
    );
  }
  assert.deepEqual(locales, ["en", "pt-BR"]);
  assert.equal(translate("pt-BR", "ui.groupHeading", { name: "Roteador", group: "Configurações" }), "Roteador / Configurações");
  assert.equal(menuText("pt-BR", "Capabilities"), "Capacidades");
  assert.equal(menuText("pt-BR", "route"), "rotear");
  assert.equal(menuText("pt-BR", "route unknown-capability"), "rotear unknown-capability");
  assert.equal(menuText("pt-BR", "Capability IDs to route (space-separated)"), "IDs das capacidades para rotear (separados por espaço)");
});

test("project locale is explicit, isolated, and trusted-only", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-router-locale-"));
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  await Promise.all([mkdir(projectA), mkdir(projectB)]);
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(await readProjectLocale(projectA, true), "en");
  assert.equal(await readProjectLocale(projectA, false), "en");
  await assert.rejects(writeProjectLocale(projectA, false, "pt-BR"), /untrusted-project/);

  await writeProjectLocale(projectA, true, "pt-BR");
  assert.equal(localePreferencePath(projectA), join(projectA, ".pi", "pi-mcp-router.locale.json"));
  assert.deepEqual(JSON.parse(await readFile(localePreferencePath(projectA), "utf8")), {
    schemaVersion: 1,
    locale: "pt-BR",
  });
  assert.equal(await readProjectLocale(projectA, true), "pt-BR");
  assert.equal(await readProjectLocale(projectA, false), "en");
  assert.equal(await readProjectLocale(projectB, true), "en");

  const preference = localePreferencePath(projectA);
  await writeFile(preference, "{broken", "utf8");
  assert.equal(await readProjectLocale(projectA, true), "en");
  await writeFile(preference, JSON.stringify({ schemaVersion: 9, locale: "pt-BR" }), "utf8");
  assert.equal(await readProjectLocale(projectA, true), "en");
  await rm(preference);
  await mkdir(preference);
  assert.equal(await readProjectLocale(projectA, true), "en");

  const abort = new AbortController();
  abort.abort();
  await assert.rejects(writeProjectLocale(projectB, true, "pt-BR", abort.signal), /operation-cancelled/);
  assert.equal(await readProjectLocale(projectB, true), "en");
});
