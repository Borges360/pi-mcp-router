import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Interop, envelope } from "../dist/common/contracts.js";
import { localBus } from "../dist/common/cli.js";
import { McpRouter } from "../dist/mcp.js";
import { defaults, validateConfig } from "../dist/common/config.js";
import extension from "../dist/extension.js";
const name = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(new URL("../package.json", import.meta.url), "utf8"),
)
  .name.split("/")
  .at(-1);
const displayName =
  {
    "pi-autoskills": "AutoSkills",
    "pi-autoplan": "AutoPlan",
    "pi-subagent-router": "Subagent Router",
    "pi-mcp-router": "MCP Router",
  }[name] ?? name;
test("event bus ignores duplicates, future schemas, old events and isolates consumer failures", async () => {
  const bus = localBus();
  const a = new Interop("a", bus, "project");
  let count = 0;
  a.listen("test.v1", () => {
    count++;
  });
  const e = envelope("b", "test.v1", {}, { projectKey: "project" });
  bus.emit("test.v1", e);
  bus.emit("test.v1", e);
  bus.emit("test.v1", { ...e, eventId: "future", schemaVersion: 2 });
  bus.emit("test.v1", {
    ...e,
    eventId: "old",
    emittedAt: "2000-01-01T00:00:00Z",
  });
  assert.equal(count, 1);
  a.listen("failure.v1", async () => {
    throw new Error("offline");
  });
  bus.emit(
    "failure.v1",
    envelope("b", "failure.v1", {}, { projectKey: "project" }),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(a.failures, 1);
  a.close();
});
test("capability discovery works regardless of startup order and removal", () => {
  const bus = localBus();
  const a = new Interop("a", bus, "p"),
    b = new Interop("b", bus, "p");
  a.start(["one"]);
  b.start(["two"]);
  assert.equal(a.healthy("b", "two"), true);
  assert.equal(b.healthy("a", "one"), true);
  b.close();
  a.close();
});
test("safe configuration rejects model escalation and malformed numeric values", () => {
  const c = defaults(name);
  assert.equal(c.storage.backend, "files");
  assert.throws(() => validateConfig({ ...c, assistantClaims: true }));
  assert.throws(() => validateConfig({ ...c, requireApproval: false }));
  assert.throws(() => validateConfig({ ...c, maxParallel: Infinity }));
  assert.throws(() =>
    validateConfig({ ...c, compactAtRatio: 0.9, handoffAtRatio: 0.7 }),
  );
});
test("extension loads independently and all discovery commands work without TUI", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-extension-test-"));
  process.env.PI_ECOSYSTEM_STATE_ROOT = join(root, "state");
  await mkdir(join(root, "cwd"));
  const cwd = join(root, "cwd");
  const handlers = new Map(),
    commands = new Map(),
    tools = new Map(),
    messages = [];
  let active = ["read", "write", "mcp__untrusted__drop"];
  const pi = {
    events: localBus(),
    on: (n, f) => {
      handlers.set(n, f);
      return () => handlers.delete(n);
    },
    registerCommand: (n, d) => commands.set(n, d),
    registerTool: (t) => {
      tools.set(t.name, t);
    },
    sendMessage: (m) => messages.push(m),
    getAllTools: () => [
      { name: "read" },
      { name: "write" },
      {
        name: "mcp__untrusted__drop",
        namespace: { name: "mcp__untrusted" },
        annotations: { readOnlyHint: true },
      },
    ],
    getActiveTools: () => active,
    setActiveTools: (tools) => {
      active = tools;
    },
    registerMcpServer: () => {},
    unregisterMcpServer: () => {},
  };
  extension(pi);
  assert.equal(commands.size, 1);
  assert.ok(tools.size >= 1);
  assert.equal(messages.length, 0);
  const ctx = {
    cwd,
    mode: "print",
    hasUI: false,
    ui: new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("TUI accessed headlessly");
        },
      },
    ),
    isProjectTrusted: () => false,
    getContextUsage: () => undefined,
    compact: () => {},
    signal: undefined,
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort: () => {},
    shutdown: () => {},
    getSystemPrompt: () => "",
    sessionManager: {},
    modelRegistry: {},
    model: undefined,
  };
  await handlers.get("session_start")?.({}, ctx);
  t.after(async () => {
    await handlers.get("session_shutdown")?.({}, ctx);
    await rm(root, { recursive: true, force: true });
    delete process.env.PI_ECOSYSTEM_STATE_ROOT;
  });
  const command = [...commands.values()][0];
  for (const action of ["status", "explain", "config", "doctor", "off", "auto"])
    await command.handler(action, ctx);
  assert.ok(messages.length >= 6);
  assert.equal(JSON.parse(messages.at(-1).content).enabled, true);
  await handlers.get("before_agent_start")?.(
    { messageType: "user", prompt: "Explain a small function" },
    ctx,
  );
  const menus = [];
  let rootSelections = 0;
  let settingsSelections = 0;
  let confirmations = 0;
  const tui = {
    ...ctx,
    mode: "tui",
    hasUI: true,
    ui: {
      select: async (title, choices) => {
        menus.push({ title, choices });
        if (title === displayName)
          return rootSelections++ === 0 ? "Settings" : undefined;
        return settingsSelections++ === 0 ? "doctor" : undefined;
      },
      confirm: async () => {
        confirmations++;
        return true;
      },
    },
  };
  await command.handler("", tui);
  assert.equal(menus.length, 4);
  assert.deepEqual(menus.map(({ title }) => title), [
    displayName,
    `${displayName} / Settings`,
    `${displayName} / Settings`,
    displayName,
  ]);
  assert.ok(menus[0].choices.includes("Capabilities"));
  assert.ok(menus[0].choices.includes("Servers"));
  assert.ok(menus[0].choices.includes("Tools"));
  assert.ok(menus[0].choices.includes("Settings"));
  assert.ok(menus[0].choices.includes("Storage"));
  assert.ok(menus[1].choices.includes("config"));
  assert.ok(menus[1].choices.includes("off"));
  assert.equal(confirmations, 1);
  assert.equal(JSON.parse(messages.at(-1).content).standalone, true);

  const keybindings = {
    getKeys: (binding) =>
      ({
        "tui.select.confirm": ["enter"],
        "tui.select.cancel": ["escape"],
        "tui.select.up": ["up"],
        "tui.select.down": ["down"],
      })[binding] ?? [],
    matches: (data, binding) =>
      ({
        "tui.select.confirm": "enter",
        "tui.select.cancel": "escape",
        "tui.select.up": "up",
        "tui.select.down": "down",
      })[binding] === data,
  };
  const theme = {
    fg: (_color, value) => value,
    bg: (_color, value) => value,
    bold: (value) => value,
  };
  const interactions = [];
  let panelInteractionError;
  const inputValues = [];
  const inputRequests = [];
  const confirmationAnswers = [];
  const confirmationRequests = [];
  let closedPanels = 0;
  let renderRequests = 0;
  const dashboardTui = {
    ...tui,
    ui: {
      select: async () => {
        if (panelInteractionError) throw panelInteractionError;
        return undefined;
      },
      input: async (title) => {
        inputRequests.push(title);
        return inputValues.shift();
      },
      confirm: async (title, message) => {
        confirmationRequests.push({ title, message });
        return confirmationAnswers.shift() ?? false;
      },
      custom: async (factory, options) => {
        assert.equal(options.overlay, true);
        const interact = interactions.shift();
        assert.equal(typeof interact, "function", "unexpected dashboard panel");
        let complete;
        const finished = new Promise((resolve) => {
          complete = resolve;
        });
        const panel = await factory(
          { requestRender: () => renderRequests++ },
          theme,
          keybindings,
          (value) => {
            closedPanels++;
            complete(value);
          },
        );
        const render = (width = 80) => panel.render(width).join("\n");
        try {
          await interact({ panel, render });
        } catch (error) {
          panelInteractionError = error;
          throw error;
        }
        return finished;
      },
    },
  };
  const cellWidth = (value) => {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(value), ({ segment }) => {
      const points = Array.from(segment, (character) =>
        character.codePointAt(0) ?? 0,
      );
      if (
        points.some(
          (point) =>
            point === 0x200d ||
            point === 0xfe0f ||
            (point >= 0x1f1e6 && point <= 0x1f1ff) ||
            (point >= 0x1f000 && point <= 0x1faff),
        )
      )
        return 2;
      let width = 0;
      for (const point of points) {
        const character = String.fromCodePoint(point);
        if (/\p{Mark}/u.test(character) || point === 0x200d) continue;
        const wide =
          point >= 0x1100 &&
          (point <= 0x115f ||
            point === 0x2329 ||
            point === 0x232a ||
            (point >= 0x2e80 && point <= 0xa4cf) ||
            (point >= 0xac00 && point <= 0xd7a3) ||
            (point >= 0xf900 && point <= 0xfaff) ||
            (point >= 0xfe10 && point <= 0xfe19) ||
            (point >= 0xfe30 && point <= 0xfe6f) ||
            (point >= 0xff00 && point <= 0xff60) ||
            (point >= 0xffe0 && point <= 0xffe6) ||
            (point >= 0x20000 && point <= 0x3fffd));
        width = Math.max(width, wide ? 2 : 1);
      }
      return width;
    }).reduce((total, width) => total + width, 0);
  };
  const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(message);
  };
  const configPath = join(defaults(name).storage.root, "config.json");

  let messageCountBeforeCancelledRoute;
  interactions.push(async ({ panel, render }) => {
    for (const width of [40, 80, 120])
      assert.ok(panel.render(width).every((line) => cellWidth(line) === width));
    assert.match(render(), /Current mode: Automatic/);
    for (const group of ["Capabilities", "Servers", "Tools", "Settings", "Storage"])
      assert.match(render(), new RegExp(group));

    await panel.handleInput("enter");
    assert.match(render(), /capabilities add/);
    await panel.handleInput("escape");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /servers/);
    await panel.handleInput("escape");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /route/);
    assert.match(render(), /check/);
    assert.match(render(), /approve/);
    await panel.handleInput("escape");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /doctor/);
    assert.match(render(), /auto/);
    assert.match(render(), /observe/);
    assert.match(render(), /off/);

    await panel.handleInput("enter");
    assert.match(render(), /Draft mode: Automatic/);
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Draft mode: Observe/);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).mode, "auto");
    await panel.handleInput("escape");
    assert.match(render(), /Press Esc again to discard/);
    await panel.handleInput("escape");
    assert.match(render(), /Draft discarded/);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).mode, "auto");
    await panel.handleInput("escape");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /storage status/);
    assert.match(render(), /storage migrate/);
    await panel.handleInput("down");
    await panel.handleInput("enter");
  });
  inputValues.push("sqlite");
  confirmationAnswers.push(false);
  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Action cancelled; nothing was changed/);
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", dashboardTui);

  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Current mode: Automatic/);
    assert.match(render(), /Draft mode: Automatic/);
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Draft mode: Observe/);
    const savedBefore = await readFile(configPath, "utf8");
    assert.equal(JSON.parse(savedBefore).mode, "auto");

    await rm(configPath, { force: true });
    await mkdir(configPath);
    await panel.handleInput("ctrl+s");
    await waitFor(
      () => render().includes("Could not save the mode"),
      "mode save failure should be visible while preserving the draft",
    );
    assert.match(render(), /Current mode: Automatic/);
    assert.match(render(), /Draft mode: Observe/);
    await command.handler("config", ctx);
    assert.equal(JSON.parse(messages.at(-1).content).mode, "auto");

    await rm(configPath, { recursive: true, force: true });
    await writeFile(configPath, savedBefore);
    await panel.handleInput("\u0013");
    await waitFor(
      () => render().includes("Saved mode: Observe"),
      "Ctrl+S should persist the staged mode",
    );
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(saved.mode, "observe");
    assert.equal(saved.enabled, true);
    await panel.handleInput("escape");
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("config", dashboardTui);

  const localePath = join(cwd, ".pi", "pi-mcp-router.locale.json");
  interactions.push(async ({ panel, render }) => {
    for (const width of [40, 80, 120])
      assert.ok(panel.render(width).every((line) => cellWidth(line) === width));
    for (let index = 0; index < 3; index++) await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /language/);
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Choose a language/);
    assert.doesNotMatch(render(), /›\s+Português \(Brasil\)/);
    await panel.handleInput("down");
    await panel.handleInput("enter");
    await panel.handleInput("ctrl+s");
    await assert.rejects(readFile(localePath, "utf8"));
    await panel.handleInput("escape");
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", dashboardTui);

  const trustedDashboardTui = {
    ...dashboardTui,
    isProjectTrusted: () => true,
  };
  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Current mode: Observe/);
    assert.match(render(), /Current language: English/);
    for (const width of [40, 80, 120])
      assert.ok(panel.render(width).every((line) => cellWidth(line) === width));
    for (let index = 0; index < 3; index++) await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Settings/);
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Choose a language/);
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Configurações/);
    assert.match(render(), /Rascunho do idioma: Português do Brasil/);
    assert.match(render(), /Escolha um idioma/);

    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(localePath);
    await panel.handleInput("ctrl+s");
    await waitFor(
      () => render().includes("Não foi possível salvar o idioma"),
      "a failed locale write should preserve the Portuguese draft",
    );
    assert.match(render(), /Idioma atual: Inglês/);
    assert.match(render(), /Rascunho do idioma: Português do Brasil/);
    await rm(localePath, { recursive: true, force: true });
    await panel.handleInput("\u0013");
    await waitFor(
      () => render().includes("Idioma salvo: Português do Brasil."),
      "Ctrl+S should persist the staged project locale",
    );
    assert.deepEqual(JSON.parse(await readFile(localePath, "utf8")), {
      schemaVersion: 1,
      locale: "pt-BR",
    });
    await panel.handleInput("escape");
    assert.match(render(), /idioma/);
    assert.match(render(), /configuração/);
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", trustedDashboardTui);

  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Idioma atual: Português do Brasil/);
    for (const group of ["Capacidades", "Servidores", "Ferramentas", "Configurações", "Armazenamento"])
      assert.match(render(), new RegExp(group));
    for (let index = 0; index < 3; index++) await panel.handleInput("down");
    await panel.handleInput("enter");
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Idioma atual: Português do Brasil/);

    await panel.handleInput("escape");
    await panel.handleInput("up");
    await panel.handleInput("up");
    await panel.handleInput("enter");
    assert.match(render(), /Modo atual: Observar/);
    assert.match(render(), /Mostra decisões de capacidades/);
    await panel.handleInput("escape");
    await panel.handleInput("escape");
    await panel.handleInput("up");
    await panel.handleInput("enter");
    assert.match(render(), /rotear/);
    assert.match(render(), /verificar/);

    messageCountBeforeCancelledRoute = messages.length;
    inputValues.push("unknown-capability");
    confirmationAnswers.push(false);
    interactions.push(async ({ panel, render }) => {
      assert.match(render(), /Ação cancelada; nada foi alterado/);
      await panel.handleInput("escape");
      await panel.handleInput("escape");
    });
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
  });
  await command.handler("", trustedDashboardTui);
  assert.equal(inputRequests.at(-1), "IDs das capacidades para rotear (separados por espaço)");
  assert.equal(confirmationRequests.at(-1).title, "Confirmar rotear");
  assert.match(confirmationRequests.at(-1).message, /Registrar uma decisão local/);
  assert.equal(messages.length, messageCountBeforeCancelledRoute);

  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Idioma atual: Português do Brasil/);
    for (let index = 0; index < 3; index++) await panel.handleInput("down");
    await panel.handleInput("enter");
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    assert.match(render(), /Idioma atual: Português do Brasil/);
    await panel.handleInput("up");
    await panel.handleInput("enter");
    assert.match(render(), /Draft language: English/);
    await panel.handleInput("escape");
    assert.match(render(), /Press Esc again to discard/);
    await panel.handleInput("escape");
    assert.match(render(), /Configurações/);
    assert.match(render(), /idioma/);
    assert.equal(
      JSON.parse(await readFile(localePath, "utf8")).locale,
      "pt-BR",
    );
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", trustedDashboardTui);

  const capabilityFile = "capability-日本🙂.json";
  await writeFile(
    join(cwd, capabilityFile),
    JSON.stringify({
      schemaVersion: 1,
      id: "demo-capability",
      description: "Temporary UI fixture",
      keywords: ["demo"],
      allowed: true,
      candidates: [
        {
          server: "example",
          name: "mcp__example__read",
          readOnly: true,
          destructive: false,
          openWorld: false,
          trusted: true,
          available: false,
        },
      ],
    }),
  );
  inputValues.push(capabilityFile);
  confirmationAnswers.push(true);
  interactions.push(async ({ panel }) => {
    await panel.handleInput("enter");
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
  });
  interactions.push(async ({ panel, render }) => {
    await waitFor(() => render().includes("Running capabilities"), "capability add should start after confirmation");
    for (const width of [40, 80, 120])
      assert.ok(panel.render(width).every((line) => cellWidth(line) === width));
    assert.match(render(), /日本🙂/);
    await waitFor(
      () =>
        messages.some((message) => JSON.parse(message.content).id === "demo-capability") ||
        render().includes("Action failed"),
      "capability add should finish or report a failure",
    );
    assert.ok(messages.some((message) => JSON.parse(message.content).id === "demo-capability"), render());
    assert.match(confirmationRequests.at(-1).title, /capabilities add/);
    await new Promise((resolve) => setImmediate(resolve));
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", dashboardTui);

  const messagesBeforeDeniedRoute = messages.length;
  inputValues.push("unknown-capability");
  confirmationAnswers.push(false);
  interactions.push(async ({ panel }) => {
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
    await panel.handleInput("down");
    await panel.handleInput("down");
    await panel.handleInput("enter");
  });
  interactions.push(async ({ panel, render }) => {
    assert.match(render(), /Action cancelled; nothing was changed/);
    await panel.handleInput("escape");
    await panel.handleInput("escape");
  });
  await command.handler("", dashboardTui);
  assert.equal(messages.length, messagesBeforeDeniedRoute);
  assert.match(confirmationRequests.at(-1).title, /route/);

  const originalCommand = McpRouter.prototype.command;
  const lateAbort = new AbortController();
  let resolveLateAction;
  McpRouter.prototype.command = function (action, args, context) {
    if (action === "servers")
      return new Promise((resolve) => {
        resolveLateAction = resolve;
      });
    return originalCommand.call(this, action, args, context);
  };
  try {
    interactions.push(async ({ panel, render }) => {
      await panel.handleInput("down");
      await panel.handleInput("enter");
      await panel.handleInput("enter");
      await waitFor(() => render().includes("Running servers"), "server action should start");
      await waitFor(() => typeof resolveLateAction === "function", "delayed action should be pending");
      lateAbort.abort();
    });
    const messagesBeforeLateAction = messages.length;
    await command.handler("", { ...dashboardTui, signal: lateAbort.signal });
    const rendersAfterClose = renderRequests;
    resolveLateAction({ servers: [] });
    for (let attempt = 0; attempt < 10; attempt++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(messages.length, messagesBeforeLateAction);
    assert.equal(renderRequests, rendersAfterClose);
  } finally {
    McpRouter.prototype.command = originalCommand;
  }

  assert.ok(closedPanels >= 7);
  assert.ok(renderRequests > 0);
  const priorMessages = messages.length;
  await command.handler("", { ...tui, ui: { select: async () => undefined } });
  assert.equal(messages.length, priorMessages);
});
