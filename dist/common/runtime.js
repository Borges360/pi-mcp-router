import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { loadConfig, saveConfig } from "./config.js";
import { FileStorage, SqliteStorage, } from "./storage.js";
import { DurableStorage } from "./durable.js";
import { Interop } from "./contracts.js";
import { menuText, readProjectLocale, translate, writeProjectLocale, } from "./i18n.js";
import { atomicWrite, canonical, digest, projectKey, redact, } from "./security.js";
export const toolResult = (value) => ({
    content: [{ type: "text", text: JSON.stringify(redact(value)) }],
    details: redact(value),
});
export class Host {
    extension;
    factory;
    cwd;
    bus;
    trusted;
    api;
    config;
    store;
    interop;
    service;
    key = "";
    started = false;
    starting;
    queue = Promise.resolve();
    migrationFault;
    constructor(extension, factory, cwd, bus, trusted = false, api) {
        this.extension = extension;
        this.factory = factory;
        this.cwd = cwd;
        this.bus = bus;
        this.trusted = trusted;
        this.api = api;
    }
    async start() {
        if (this.started)
            return;
        if (!this.starting)
            this.starting = this.initialize().finally(() => {
                this.starting = undefined;
            });
        return this.starting;
    }
    async initialize() {
        try {
            await this.initializeResources();
        }
        catch (error) {
            this.interop?.close();
            await this.service?.close?.().catch(() => { });
            await this.store?.close().catch(() => { });
            throw error;
        }
    }
    async initializeResources() {
        this.config = await loadConfig(this.extension, this.cwd, this.trusted);
        this.key = await projectKey(this.cwd);
        const base = join(this.config.storage.root, "projects", this.key);
        await mkdir(base, { recursive: true, mode: 0o700 });
        let backend = this.config.storage.backend;
        let root = base;
        try {
            const pointer = JSON.parse(await readFile(join(base, "backend.json"), "utf8"));
            if (!["files", "sqlite", "durable"].includes(pointer.backend) ||
                !/^migration-[a-zA-Z0-9-]+$/.test(pointer.directory))
                throw new Error("invalid-backend-pointer");
            backend = pointer.backend;
            root = join(base, pointer.directory);
        }
        catch (e) {
            if (e.code !== "ENOENT")
                throw e;
        }
        this.store =
            backend === "files"
                ? new FileStorage({ root, extension: this.extension })
                : backend === "sqlite"
                    ? new SqliteStorage({ root, extension: this.extension })
                    : new DurableStorage({ root, extension: this.extension });
        await this.store.open();
        const metadata = await this.store.getMetadata();
        if (metadata.migratedTo) {
            // An old backend is only selected when the pointer switch did not commit.
            // Its own journal is still authoritative, so rollback never replays effects.
            if (metadata.migrationHost !== hostname() || !metadata.migrationPid)
                throw new Error("migration-owner-review-required");
            let dead = false;
            try {
                process.kill(metadata.migrationPid, 0);
            }
            catch (error) {
                dead = error.code === "ESRCH";
            }
            if (!dead)
                throw new Error("migration-in-progress");
            await this.store.rollbackMigration(metadata.migratedTo);
        }
        this.interop = new Interop(this.extension, this.bus, this.key, this.config.disabledIntegrations);
        this.service = this.factory(this);
        await this.service.start?.();
        this.interop.start(this.service.capabilities);
        this.started = true;
    }
    async close() {
        await this.starting?.catch(() => { });
        if (!this.started)
            return;
        this.interop.close();
        await this.service.close?.();
        await this.store.close();
        this.started = false;
    }
    serial(fn) {
        const result = this.queue.then(fn);
        this.queue = result.catch(() => { });
        return result;
    }
    async configure(patch) {
        const nextConfig = await loadConfig(this.extension, this.cwd, this.trusted, {
            ...this.config,
            ...patch,
        });
        await saveConfig(this.extension, nextConfig);
        this.config = nextConfig;
        return nextConfig;
    }
    async doctor() {
        const recovery = await this.store.recover();
        return {
            extension: this.extension,
            version: "0.1.0",
            pi: "1.2.0",
            node: process.versions.node,
            enabled: this.config.enabled,
            mode: this.config.mode,
            storage: this.store.constructor.name,
            recovery,
            integrations: {
                failures: this.interop.failures,
                fallbacks: this.interop.fallbacks,
                incompatible: this.interop.incompatible,
            },
            standalone: true,
        };
    }
    async command(action, args, context) {
        if (action === "doctor")
            return this.doctor();
        if (action === "config")
            return this.config;
        if (action === "off" || action === "auto" || action === "observe")
            return this.configure({ enabled: action !== "off", mode: action });
        if (action === "storage")
            return args[0] === "migrate"
                ? this.migrate(args[1])
                : {
                    backend: this.store.constructor.name,
                    root: this.store.options.root,
                };
        return this.service.command(action, args, context);
    }
    async migrate(backend) {
        if (backend !== "files" && backend !== "sqlite" && backend !== "durable")
            throw new Error("supported-backends: files, sqlite, durable");
        const activeChildren = await this.store.listRecords("children");
        const activeRuns = await this.store.listRecords("runs");
        if (activeChildren.some((c) => c.status === "running") ||
            activeRuns.some((r) => r.status === "active"))
            throw new Error("pause-active-work-before-migration");
        const sourceStore = this.store;
        const migrationId = crypto.randomUUID();
        const base = join(this.config.storage.root, "projects", this.key);
        const directory = "migration-" + migrationId;
        const root = join(base, directory);
        const target = backend === "files"
            ? new FileStorage({ root, extension: this.extension })
            : backend === "sqlite"
                ? new SqliteStorage({ root, extension: this.extension })
                : new DurableStorage({ root, extension: this.extension });
        await target.open();
        let switched = false;
        let sealed = false;
        let previousPointer;
        try {
            previousPointer = await readFile(join(base, "backend.json"), "utf8");
        }
        catch (e) {
            if (e.code !== "ENOENT")
                throw e;
        }
        try {
            await this.store.transact(async (source) => {
                const frozen = structuredClone(source);
                const logical = (s) => digest({
                    metadata: s.metadata,
                    records: s.records,
                    events: s.events,
                    blobs: s.blobs,
                });
                await target.importSnapshot(frozen);
                if (logical(await target.exportSnapshot()) !== logical(frozen))
                    throw new Error("migration-parity-failed");
                await target.recover();
                source.metadata.migratedTo = root;
                source.metadata.migrationPid = process.pid;
                source.metadata.migrationHost = hostname();
            });
            sealed = true;
            this.migrationFault?.("after-seal");
            await atomicWrite(join(base, "backend.json"), canonical({
                schemaVersion: 1,
                backend,
                directory,
                migrationId,
                sourceRoot: this.store.options.root,
            }));
            switched = true;
            this.migrationFault?.("after-pointer");
            await target.recover();
            await this.service.close?.();
            this.store = target;
            // Services capture Host, never a stale store handle; restart listeners after backend replacement.
            this.interop.close();
            this.interop = new Interop(this.extension, this.bus, this.key, this.config.disabledIntegrations);
            this.service = this.factory(this);
            await this.service.start?.();
            this.interop.start(this.service.capabilities);
            await sourceStore.close();
            return { migrationId, backend, verified: true, backupPreserved: true };
        }
        catch (e) {
            if (switched) {
                if (previousPointer)
                    await atomicWrite(join(base, "backend.json"), previousPointer);
                else
                    await unlink(join(base, "backend.json"));
            }
            this.store = sourceStore;
            if (sealed)
                await sourceStore.rollbackMigration(root);
            await target.close();
            throw e;
        }
    }
}
export function register(pi, extension, command, factory, tools = []) {
    let host;
    const get = async (ctx) => {
        if (!host || host.cwd !== ctx.cwd) {
            await host?.close();
            host = new Host(extension, factory, ctx.cwd, pi.events, ctx.isProjectTrusted(), pi);
            await host.start();
        }
        await host.start();
        return host;
    };
    const show = (value) => pi.sendMessage({
        customType: extension,
        content: JSON.stringify(redact(value), null, 2),
        display: true,
    });
    pi.on("session_start", async (_e, ctx) => {
        await get(ctx);
    });
    pi.on("session_shutdown", async () => {
        await host?.close();
        host = undefined;
    });
    pi.registerCommand(command, {
        description: `${extension}: status, explain, config, doctor`,
        handler: async (args, ctx) => {
            const h = await get(ctx);
            const localizes = extension === "pi-mcp-router";
            let locale = localizes
                ? await readProjectLocale(ctx.cwd, ctx.isProjectTrusted())
                : "en";
            const tr = (key, values = {}, forLocale = locale) => translate(localizes ? forLocale : "en", key, values);
            const visibleText = (value, forLocale = locale) => localizes ? menuText(forLocale, value) : value;
            let parts = args.trim().split(/\s+/).filter(Boolean);
            const interactive = ctx.mode === "tui" && ctx.hasUI;
            const displayNames = {
                longrun: "Longrun",
                autoskills: "AutoSkills",
                autoplan: "AutoPlan",
                subagents: "Subagent Router",
                mcprouter: "MCP Router",
            };
            const displayName = localizes ? tr("app.name") : displayNames[command] ?? extension;
            const groups = h.service.menuGroups ?? {
                Actions: h.service.menu,
                Settings: ["config", "doctor"],
            };
            const options = [
                {
                    action: "auto",
                    label: "Automatic",
                    description: h.service.modeDescriptions?.auto ??
                        "Allow eligible actions when this extension's policy permits.",
                },
                {
                    action: "observe",
                    label: "Observe",
                    description: h.service.modeDescriptions?.observe ??
                        "Show decisions without acting automatically.",
                },
                {
                    action: "off",
                    label: "Off",
                    description: h.service.modeDescriptions?.off ??
                        "Disable this extension's automatic behavior.",
                },
            ];
            const formatKey = (key) => ({
                enter: "Enter",
                return: "Enter",
                escape: "Esc",
                "ctrl+c": "Ctrl+C",
                up: "↑",
                down: "↓",
            })[key.toLowerCase()] ?? key.toUpperCase();
            const keyText = (keys, fallback) => keys.map(formatKey).join(" / ") || fallback;
            const currentMode = () => !h.config.enabled || h.config.mode === "off"
                ? "off"
                : h.config.mode === "observe"
                    ? "observe"
                    : "auto";
            const modeLabel = (mode, forLocale = locale) => {
                const key = mode === "observe"
                    ? "mode.observe"
                    : mode === "off"
                        ? "mode.off"
                        : "mode.automatic";
                return localizes
                    ? tr(key, {}, forLocale)
                    : options.find((option) => option.action === mode)?.label ?? "Automatic";
            };
            const languageLabel = (value, forLocale = locale) => value === "pt-BR"
                ? tr("language.portugueseName", {}, forLocale)
                : tr("language.englishName", {}, forLocale);
            const languageChoices = (forLocale, trusted) => {
                const values = trusted ? ["en", "pt-BR"] : ["en"];
                return values.map((value) => ({
                    value,
                    label: value === "pt-BR"
                        ? tr("language.portuguese", {}, forLocale)
                        : tr("language.english", {}, forLocale),
                }));
            };
            const modeDescription = (action, forLocale = locale) => {
                const fallbackKey = action === "auto"
                    ? "mode.defaultAutoDescription"
                    : action === "observe"
                        ? "mode.defaultObserveDescription"
                        : "mode.defaultOffDescription";
                const description = h.service.modeDescriptions?.[action] ?? tr(fallbackKey, {}, forLocale);
                return visibleText(description, forLocale);
            };
            const segmenter = new Intl.Segmenter(undefined, {
                granularity: "grapheme",
            });
            const graphemes = (value) => Array.from(segmenter.segment(value), (part) => part.segment);
            const graphemeWidth = (value) => {
                const points = Array.from(value, (character) => character.codePointAt(0) ?? 0);
                if (!points.length)
                    return 0;
                if (points.some((point) => point === 0x200d ||
                    point === 0xfe0f ||
                    (point >= 0x1f1e6 && point <= 0x1f1ff) ||
                    (point >= 0x1f000 && point <= 0x1faff)))
                    return 2;
                let width = 0;
                for (const point of points) {
                    const character = String.fromCodePoint(point);
                    if (/\p{Mark}/u.test(character) ||
                        point === 0x200d ||
                        point === 0xfe0e ||
                        point === 0xfe0f)
                        continue;
                    const wide = point >= 0x1100 &&
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
            };
            const fitLine = (value, width) => {
                const cells = Math.max(1, Math.floor(width));
                const clean = String(value).replace(/[\r\n\t]/g, " ").replace(/\p{Cc}/gu, " ");
                const parts = graphemes(clean);
                const totalWidth = parts.reduce((total, part) => total + graphemeWidth(part), 0);
                if (totalWidth <= cells)
                    return clean + " ".repeat(Math.max(0, cells - totalWidth));
                let output = "";
                let used = 0;
                for (const part of parts) {
                    const partWidth = graphemeWidth(part);
                    if (partWidth && used + partWidth > cells)
                        break;
                    output += part;
                    used += partWidth;
                }
                if (used < cells) {
                    output += "…";
                    used++;
                }
                return output + " ".repeat(Math.max(0, cells - used));
            };
            const fallbackModePanel = async (initialDraft) => {
                while (true) {
                    const savedMode = currentMode();
                    let draft = initialDraft
                        ? options.find((option) => option.action === initialDraft)
                        : undefined;
                    if (!initialDraft) {
                        const selected = await ctx.ui.select(tr("ui.modeHeading", { name: displayName }) +
                            " — " +
                            tr("ui.currentMode", { mode: modeLabel(savedMode) }), options.map((option) => modeLabel(option.action)));
                        if (!selected)
                            return;
                        draft = options.find((option) => modeLabel(option.action) === selected);
                    }
                    initialDraft = undefined;
                    if (!draft)
                        return;
                    const decision = await ctx.ui.select(tr("ui.draftMode", { mode: modeLabel(draft.action) }), [tr("ui.save"), tr("ui.discard")]);
                    if (decision === tr("ui.discard"))
                        continue;
                    if (decision !== tr("ui.save"))
                        return;
                    try {
                        await h.serial(() => h.command(draft.action, [], {
                            cwd: ctx.cwd,
                            trusted: ctx.isProjectTrusted(),
                            hostContext: ctx,
                            commandContext: ctx,
                            signal: ctx.signal,
                        }));
                        return;
                    }
                    catch {
                        ctx.ui.notify(tr("ui.couldNotSaveMode"));
                    }
                }
            };
            const fallbackLanguagePanel = async () => {
                const trusted = ctx.isProjectTrusted();
                if (!trusted) {
                    ctx.ui.notify(tr("ui.portugueseTrustedOnly"));
                    return;
                }
                const savedLocale = locale;
                let draftLocale = savedLocale;
                while (true) {
                    const choices = languageChoices(draftLocale, trusted);
                    const selected = await ctx.ui.select(tr("ui.chooseLanguage", {}, draftLocale), choices.map((choice) => choice.label));
                    if (!selected) {
                        locale = savedLocale;
                        return;
                    }
                    draftLocale = choices.find((choice) => choice.label === selected)?.value ?? savedLocale;
                    locale = draftLocale;
                    const decision = await ctx.ui.select(tr("ui.draftLanguage", { language: languageLabel(draftLocale, draftLocale) }, draftLocale), [tr("language.saveChoice", {}, draftLocale), tr("ui.discard", {}, draftLocale)]);
                    if (decision === tr("ui.discard", {}, draftLocale)) {
                        locale = savedLocale;
                        return;
                    }
                    if (decision !== tr("language.saveChoice", {}, draftLocale)) {
                        locale = savedLocale;
                        return;
                    }
                    try {
                        await writeProjectLocale(ctx.cwd, ctx.isProjectTrusted(), draftLocale);
                        locale = draftLocale;
                        ctx.ui.notify(tr("language.savedNotice", {}, locale));
                        return;
                    }
                    catch {
                        locale = draftLocale;
                        ctx.ui.notify(tr("language.failedNotice", {}, locale));
                    }
                }
            };
            const showDashboard = async (initialPage = "groups") => {
                if (typeof ctx.ui.custom !== "function")
                    return false;
                const groupNames = Object.keys(groups);
                let page = initialPage;
                let selectedGroup = initialPage === "mode" || initialPage === "language" ? "Settings" : "";
                let selectedIndex = initialPage === "mode"
                    ? Math.max(0, options.findIndex((option) => option.action === currentMode()))
                    : initialPage === "language"
                        ? Math.max(0, languageChoices(locale, ctx.isProjectTrusted()).findIndex((choice) => choice.value === locale))
                        : 0;
                let savedMode = currentMode();
                let draftMode = savedMode;
                let savedLocale = locale;
                let draftLocale = locale;
                let status = "";
                let escapeArmed = false;
                let pendingAction;
                while (true) {
                    let exit;
                    try {
                        exit = await ctx.ui.custom((tui, theme, keybindings, done) => {
                            let disposed = false;
                            let busy = false;
                            let operationId = 0;
                            let operation;
                            const confirmKeys = keyText(keybindings.getKeys("tui.select.confirm"), "Enter");
                            const cancelKeys = keyText(keybindings.getKeys("tui.select.cancel"), "Esc");
                            const upKeys = keyText(keybindings.getKeys("tui.select.up"), "↑");
                            const downKeys = keyText(keybindings.getKeys("tui.select.down"), "↓");
                            const finish = (result) => {
                                if (disposed)
                                    return;
                                disposed = true;
                                operation?.abort();
                                ctx.signal?.removeEventListener("abort", onContextAbort);
                                done(result);
                            };
                            const onContextAbort = () => finish({ type: "close" });
                            ctx.signal?.addEventListener("abort", onContextAbort, {
                                once: true,
                            });
                            if (ctx.signal?.aborted)
                                onContextAbort();
                            const isKey = (data, binding, fallback) => {
                                try {
                                    if (keybindings.matches(data, binding))
                                        return true;
                                }
                                catch {
                                    // The host key matcher is optional in test and fallback UIs.
                                }
                                return fallback.includes(data.toLowerCase());
                            };
                            const requestRender = () => {
                                if (!disposed)
                                    tui.requestRender();
                            };
                            const uiTranslate = (key, values = {}) => tr(key, values, page === "language" ? draftLocale : locale);
                            const startOperation = (action, args, label, modeToSave) => {
                                if (busy || disposed)
                                    return;
                                const controller = new AbortController();
                                const id = ++operationId;
                                operation = controller;
                                busy = true;
                                escapeArmed = false;
                                status = modeToSave
                                    ? tr("ui.savingMode")
                                    : tr("ui.running", { label: visibleText(label) });
                                requestRender();
                                void h
                                    .serial(() => {
                                    if (controller.signal.aborted)
                                        throw new Error("operation-cancelled");
                                    return h.command(action, args, {
                                        cwd: ctx.cwd,
                                        trusted: ctx.isProjectTrusted(),
                                        hostContext: ctx,
                                        commandContext: ctx,
                                        signal: controller.signal,
                                    });
                                })
                                    .then((result) => {
                                    if (disposed || id !== operationId)
                                        return;
                                    operation = undefined;
                                    busy = false;
                                    if (controller.signal.aborted) {
                                        status = tr("ui.cancelledReady");
                                    }
                                    else if (modeToSave) {
                                        savedMode = modeToSave;
                                        draftMode = modeToSave;
                                        status = tr("ui.savedMode", { mode: modeLabel(modeToSave) });
                                    }
                                    else {
                                        show(result);
                                        status = tr("ui.completed", { label: visibleText(label) });
                                    }
                                    requestRender();
                                })
                                    .catch(() => {
                                    if (disposed || id !== operationId)
                                        return;
                                    operation = undefined;
                                    busy = false;
                                    status = controller.signal.aborted
                                        ? tr("ui.cancelledReady")
                                        : modeToSave
                                            ? tr("ui.couldNotSaveMode")
                                            : tr("ui.actionFailed");
                                    requestRender();
                                });
                            };
                            const saveLanguage = () => {
                                if (busy || disposed)
                                    return;
                                if (!ctx.isProjectTrusted()) {
                                    status = uiTranslate("ui.portugueseTrustedOnly");
                                    requestRender();
                                    return;
                                }
                                if (draftLocale === savedLocale) {
                                    status = uiTranslate("ui.languageAlreadySaved");
                                    requestRender();
                                    return;
                                }
                                const nextLocale = draftLocale;
                                const controller = new AbortController();
                                const id = ++operationId;
                                operation = controller;
                                busy = true;
                                escapeArmed = false;
                                status = tr("ui.savingLanguage", {}, nextLocale);
                                requestRender();
                                void h
                                    .serial(() => writeProjectLocale(ctx.cwd, ctx.isProjectTrusted(), nextLocale, controller.signal))
                                    .then(() => {
                                    if (disposed || id !== operationId)
                                        return;
                                    operation = undefined;
                                    busy = false;
                                    savedLocale = nextLocale;
                                    draftLocale = nextLocale;
                                    locale = nextLocale;
                                    status = tr("ui.savedLanguage", { language: languageLabel(nextLocale, nextLocale) }, nextLocale);
                                    requestRender();
                                })
                                    .catch(async () => {
                                    if (disposed || id !== operationId)
                                        return;
                                    operation = undefined;
                                    busy = false;
                                    if (controller.signal.aborted) {
                                        const persisted = await readProjectLocale(ctx.cwd, ctx.isProjectTrusted());
                                        if (persisted === nextLocale) {
                                            savedLocale = nextLocale;
                                            locale = nextLocale;
                                        }
                                        status = uiTranslate("ui.cancelledReady");
                                    }
                                    else {
                                        status = tr("ui.couldNotSaveLanguage", {}, nextLocale);
                                    }
                                    requestRender();
                                });
                            };
                            const selectedLabels = () => {
                                if (page === "groups")
                                    return groupNames;
                                if (page === "actions")
                                    return groups[selectedGroup] ?? [];
                                if (page === "language")
                                    return languageChoices(draftLocale, ctx.isProjectTrusted()).map((choice) => choice.label);
                                return options.map((option) => modeLabel(option.action));
                            };
                            const lines = [];
                            const push = (text, flags = {}) => lines.push({ text, ...flags });
                            const component = {
                                render(width) {
                                    lines.length = 0;
                                    const uiLocale = page === "language" ? draftLocale : locale;
                                    const tUi = (key, values = {}) => tr(key, values, uiLocale);
                                    if (page === "groups") {
                                        push(displayName, { heading: true });
                                        push("");
                                        push(tUi("ui.currentMode", { mode: modeLabel(savedMode, uiLocale) }));
                                        if (localizes)
                                            push(tUi("ui.currentLanguage", { language: languageLabel(locale, uiLocale) }));
                                        push("");
                                        push(tUi("ui.groups"), { heading: true });
                                        groupNames.forEach((group, index) => push((index === selectedIndex ? "› " : "  ") + visibleText(group, uiLocale), {
                                            selected: index === selectedIndex,
                                        }));
                                        push("");
                                        push(tUi("ui.groupHelp", {
                                            up: upKeys,
                                            down: downKeys,
                                            move: tUi("ui.move"),
                                            confirm: confirmKeys,
                                            open: tUi("ui.open"),
                                            cancel: cancelKeys,
                                            close: tUi("ui.close"),
                                        }));
                                    }
                                    else if (page === "actions") {
                                        push(tUi("ui.groupHeading", { name: displayName, group: visibleText(selectedGroup, uiLocale) }), {
                                            heading: true,
                                        });
                                        push("");
                                        push(tUi("ui.actions"), { heading: true });
                                        (groups[selectedGroup] ?? []).forEach((action, index) => push((index === selectedIndex ? "› " : "  ") + visibleText(action, uiLocale), {
                                            selected: index === selectedIndex,
                                        }));
                                        push("");
                                        push(tUi("ui.actionHelp", {
                                            up: upKeys,
                                            down: downKeys,
                                            move: tUi("ui.move"),
                                            confirm: confirmKeys,
                                            open: tUi("ui.open"),
                                            cancel: cancelKeys,
                                            back: tUi("ui.back"),
                                        }));
                                    }
                                    else if (page === "mode") {
                                        push(tUi("ui.modeHeading", { name: displayName }), {
                                            heading: true,
                                        });
                                        push("");
                                        push(tUi("ui.currentMode", { mode: modeLabel(savedMode, uiLocale) }));
                                        push(tUi("ui.draftMode", { mode: modeLabel(draftMode, uiLocale) }));
                                        push("");
                                        push(tUi("ui.chooseMode"), { heading: true });
                                        options.forEach((option, index) => push((index === selectedIndex ? "› " : "  ") +
                                            modeLabel(option.action, uiLocale) +
                                            (option.action === savedMode ? `  (${tUi("ui.saved")})` : "") +
                                            (option.action === draftMode ? `  (${tUi("ui.draft")})` : ""), { selected: index === selectedIndex }));
                                        push("");
                                        const selected = options[selectedIndex];
                                        push(selected ? modeDescription(selected.action, uiLocale) : "");
                                        push("");
                                        push(tUi("ui.modeHelp", {
                                            up: upKeys,
                                            down: downKeys,
                                            move: tUi("ui.move"),
                                            confirm: confirmKeys,
                                            chooseDraft: tUi("ui.chooseDraft"),
                                            save: tUi("ui.save"),
                                            cancel: cancelKeys,
                                            back: tUi("ui.back") + (draftMode === savedMode ? "" : ` / ${tUi("ui.discard")}`),
                                        }));
                                    }
                                    else {
                                        push(tUi("ui.languageHeading", { name: displayName }), { heading: true });
                                        push("");
                                        push(tUi("ui.currentLanguage", { language: languageLabel(savedLocale, uiLocale) }));
                                        push(tUi("ui.draftLanguage", { language: languageLabel(draftLocale, uiLocale) }));
                                        push("");
                                        push(tUi("ui.chooseLanguage"), { heading: true });
                                        const choices = languageChoices(uiLocale, ctx.isProjectTrusted());
                                        choices.forEach((choice, index) => push((index === selectedIndex ? "› " : "  ") +
                                            choice.label +
                                            (choice.value === savedLocale ? `  (${tUi("ui.saved")})` : "") +
                                            (choice.value === draftLocale ? `  (${tUi("ui.draft")})` : ""), { selected: index === selectedIndex }));
                                        if (!ctx.isProjectTrusted()) {
                                            push("");
                                            push(tUi("ui.portugueseTrustedOnly"));
                                        }
                                        push("");
                                        push(tUi("ui.languageHelp", {
                                            up: upKeys,
                                            down: downKeys,
                                            move: tUi("ui.move"),
                                            confirm: confirmKeys,
                                            chooseDraft: tUi("ui.chooseDraft"),
                                            save: tUi("ui.save"),
                                            cancel: cancelKeys,
                                            back: tUi("ui.back") + (draftLocale === savedLocale ? "" : ` / ${tUi("ui.discard")}`),
                                        }));
                                    }
                                    if (busy)
                                        push(tUi("ui.working"));
                                    if (status)
                                        push(status);
                                    return lines.map((line) => {
                                        const visible = fitLine(line.text, width);
                                        const foreground = line.heading || line.selected
                                            ? theme.fg("accent", theme.bold(visible))
                                            : theme.fg("toolOutput", visible);
                                        return theme.bg("toolPendingBg", foreground);
                                    });
                                },
                                invalidate() { },
                                async handleInput(data) {
                                    if (disposed)
                                        return;
                                    if (isKey(data, "tui.select.cancel", [
                                        "escape",
                                        "\u001b",
                                    ])) {
                                        if (busy) {
                                            operation?.abort();
                                            status = uiTranslate("ui.cancellationRequested");
                                            requestRender();
                                            return;
                                        }
                                        if (page === "language" && draftLocale !== savedLocale) {
                                            if (!escapeArmed) {
                                                escapeArmed = true;
                                                status = uiTranslate("ui.unsavedDiscard");
                                                requestRender();
                                                return;
                                            }
                                            draftLocale = savedLocale;
                                            locale = savedLocale;
                                            escapeArmed = false;
                                            selectedIndex = Math.max(0, languageChoices(savedLocale, ctx.isProjectTrusted()).findIndex((choice) => choice.value === savedLocale));
                                            page = "actions";
                                            selectedIndex = Math.max(0, (groups[selectedGroup] ?? []).findIndex((action) => action === "language"));
                                            status = tr("ui.draftDiscarded", {}, savedLocale);
                                            requestRender();
                                            return;
                                        }
                                        if (page === "mode" && draftMode !== savedMode) {
                                            if (!escapeArmed) {
                                                escapeArmed = true;
                                                status = uiTranslate("ui.unsavedDiscard");
                                                requestRender();
                                                return;
                                            }
                                            draftMode = savedMode;
                                            escapeArmed = false;
                                            selectedIndex = Math.max(0, options.findIndex((option) => option.action === savedMode));
                                            page = "actions";
                                            status = uiTranslate("ui.draftDiscarded");
                                            requestRender();
                                            return;
                                        }
                                        escapeArmed = false;
                                        status = "";
                                        if (page === "mode") {
                                            page = "actions";
                                            selectedIndex = Math.max(0, (groups[selectedGroup] ?? []).findIndex((action) => action.split(/\s+/)[0] === "config" ||
                                                action.split(/\s+/)[0] === "mode"));
                                        }
                                        else if (page === "language") {
                                            page = "actions";
                                            selectedIndex = Math.max(0, (groups[selectedGroup] ?? []).findIndex((action) => action === "language"));
                                        }
                                        else if (page === "actions") {
                                            page = "groups";
                                            selectedIndex = Math.max(0, groupNames.indexOf(selectedGroup));
                                        }
                                        else {
                                            finish({ type: "close" });
                                        }
                                        requestRender();
                                        return;
                                    }
                                    if (busy)
                                        return;
                                    if ((page === "mode" || page === "language") &&
                                        (data === "\u0013" ||
                                            data.toLowerCase() === "ctrl+s")) {
                                        if (page === "language") {
                                            saveLanguage();
                                            return;
                                        }
                                        if (draftMode === savedMode) {
                                            status = uiTranslate("ui.modeAlreadySaved");
                                            requestRender();
                                            return;
                                        }
                                        startOperation(draftMode, [], "mode " + draftMode, draftMode);
                                        return;
                                    }
                                    if (isKey(data, "tui.select.up", ["up", "\u001b[A"])) {
                                        const count = selectedLabels().length;
                                        if (count)
                                            selectedIndex = (selectedIndex + count - 1) % count;
                                        escapeArmed = false;
                                        status = "";
                                        requestRender();
                                        return;
                                    }
                                    if (isKey(data, "tui.select.down", ["down", "\u001b[B"])) {
                                        const count = selectedLabels().length;
                                        if (count)
                                            selectedIndex = (selectedIndex + 1) % count;
                                        escapeArmed = false;
                                        status = "";
                                        requestRender();
                                        return;
                                    }
                                    if (!isKey(data, "tui.select.confirm", ["enter", "\r"]))
                                        return;
                                    escapeArmed = false;
                                    status = "";
                                    if (page === "groups") {
                                        selectedGroup = groupNames[selectedIndex] ?? groupNames[0] ?? "";
                                        page = "actions";
                                        selectedIndex = 0;
                                        requestRender();
                                        return;
                                    }
                                    if (page === "actions") {
                                        const selected = (groups[selectedGroup] ?? [])[selectedIndex];
                                        if (!selected)
                                            return;
                                        const tokens = selected.split(/\s+/).filter(Boolean);
                                        const action = tokens.shift() ?? "status";
                                        if (action === "language" && localizes) {
                                            savedLocale = locale;
                                            draftLocale = locale;
                                            page = "language";
                                            selectedIndex = Math.max(0, languageChoices(locale, ctx.isProjectTrusted()).findIndex((choice) => choice.value === locale));
                                            requestRender();
                                            return;
                                        }
                                        if (action === "config" || action === "mode") {
                                            page = "mode";
                                            draftMode = savedMode;
                                            selectedIndex = Math.max(0, options.findIndex((option) => option.action === savedMode));
                                            status = uiTranslate("ui.enterChoosesDraft");
                                            requestRender();
                                            return;
                                        }
                                        if (action === "auto" || action === "observe" || action === "off") {
                                            page = "mode";
                                            draftMode = action;
                                            selectedIndex = Math.max(0, options.findIndex((option) => option.action === action));
                                            status = uiTranslate("ui.modeDraftSelected");
                                            requestRender();
                                            return;
                                        }
                                        const inputTitle = h.service.menuInputs?.[selected];
                                        const confirmation = h.service.menuConfirmations?.[selected];
                                        if (inputTitle) {
                                            finish({
                                                type: "input",
                                                title: visibleText(inputTitle),
                                                action,
                                                args: tokens,
                                                label: selected,
                                            });
                                            return;
                                        }
                                        if (confirmation) {
                                            finish({
                                                type: "confirm",
                                                title: uiTranslate("ui.confirm", { label: visibleText(selected) }),
                                                message: visibleText(confirmation),
                                                action,
                                                args: tokens,
                                                label: selected,
                                            });
                                            return;
                                        }
                                        startOperation(action, tokens, selected);
                                        return;
                                    }
                                    if (page === "language") {
                                        const choice = languageChoices(draftLocale, ctx.isProjectTrusted())[selectedIndex];
                                        if (!choice)
                                            return;
                                        draftLocale = choice.value;
                                        locale = choice.value;
                                        status = uiTranslate("ui.languageDraftSelected");
                                    }
                                    else {
                                        const selected = options[selectedIndex];
                                        if (!selected)
                                            return;
                                        draftMode = selected.action;
                                        status =
                                            draftMode === savedMode
                                                ? uiTranslate("ui.modeDraftMatches")
                                                : uiTranslate("ui.modeDraftSelected");
                                    }
                                    requestRender();
                                },
                            };
                            if (pendingAction) {
                                const pending = pendingAction;
                                pendingAction = undefined;
                                queueMicrotask(() => startOperation(pending.action, pending.args, pending.label));
                            }
                            return component;
                        }, {
                            overlay: true,
                            overlayOptions: {
                                width: "72%",
                                maxHeight: 18,
                                anchor: "center",
                                margin: 1,
                            },
                        });
                    }
                    catch {
                        return false;
                    }
                    if (!exit || exit.type === "close")
                        return true;
                    if (exit.type === "confirm") {
                        if (typeof ctx.ui.confirm === "function" &&
                            (await ctx.ui.confirm(exit.title, exit.message))) {
                            pendingAction = {
                                action: exit.action,
                                args: exit.args,
                                label: exit.label,
                            };
                        }
                        else {
                            status = tr("ui.actionCancelled");
                        }
                        continue;
                    }
                    const value = await ctx.ui.input(exit.title);
                    if (!value?.trim()) {
                        status = tr("ui.inputCancelled");
                        continue;
                    }
                    const inputArgs = exit.action === "route" || exit.action === "check"
                        ? value.trim().split(/\s+/)
                        : [value.trim()];
                    const args = [...exit.args, ...inputArgs];
                    const confirmation = h.service.menuConfirmations?.[exit.label];
                    if (confirmation &&
                        !(typeof ctx.ui.confirm === "function" &&
                            (await ctx.ui.confirm(tr("ui.confirm", { label: visibleText(exit.label) }), visibleText(confirmation))))) {
                        status = tr("ui.actionCancelled");
                        continue;
                    }
                    const label = exit.action + " " + value.trim();
                    pendingAction = {
                        action: exit.action,
                        args,
                        label,
                    };
                }
            };
            const fallbackRunMenu = async (initialGroup) => {
                let group = initialGroup;
                while (true) {
                    if (!group) {
                        const canonicalGroups = Object.keys(groups);
                        const selectedGroup = await ctx.ui.select(displayName, canonicalGroups.map((value) => visibleText(value)));
                        if (!selectedGroup)
                            return;
                        group = canonicalGroups[canonicalGroups
                            .map((value) => visibleText(value))
                            .indexOf(selectedGroup)];
                        if (!group)
                            return;
                    }
                    const canonicalActions = groups[group] ?? [];
                    const selectedActionLabel = await ctx.ui.select(displayName + " / " + visibleText(group), canonicalActions.map((value) => visibleText(value)));
                    if (!selectedActionLabel) {
                        group = undefined;
                        continue;
                    }
                    const selected = canonicalActions[canonicalActions
                        .map((value) => visibleText(value))
                        .indexOf(selectedActionLabel)];
                    if (!selected)
                        continue;
                    const selectedParts = selected.split(/\s+/).filter(Boolean);
                    const selectedAction = selectedParts[0] ?? "status";
                    if (selectedAction === "language" && localizes) {
                        await fallbackLanguagePanel();
                        continue;
                    }
                    if (selectedAction === "config" || selectedAction === "mode") {
                        await fallbackModePanel();
                        continue;
                    }
                    if (selectedAction === "auto" || selectedAction === "observe" || selectedAction === "off") {
                        await fallbackModePanel(selectedAction);
                        continue;
                    }
                    const inputTitle = h.service.menuInputs?.[selected];
                    if (inputTitle) {
                        const value = await ctx.ui.input(visibleText(inputTitle));
                        if (!value?.trim())
                            continue;
                        selectedParts.push(...(selectedAction === "route" || selectedAction === "check"
                            ? value.trim().split(/\s+/)
                            : [value.trim()]));
                    }
                    const action = selectedParts.shift() ?? "status";
                    const confirmation = h.service.menuConfirmations?.[selected];
                    if (confirmation &&
                        !(typeof ctx.ui.confirm === "function" &&
                            (await ctx.ui.confirm(tr("ui.confirm", { label: visibleText(selected) }), visibleText(confirmation)))))
                        continue;
                    const result = await h.serial(() => h.command(action, selectedParts, {
                        cwd: ctx.cwd,
                        trusted: ctx.isProjectTrusted(),
                        hostContext: ctx,
                        commandContext: ctx,
                        signal: ctx.signal,
                    }));
                    show(result);
                }
            };
            if (interactive && !parts.length) {
                if (!(await showDashboard()))
                    await fallbackRunMenu();
                return;
            }
            let action = parts.shift() ?? "status";
            if (action === "mode")
                action = "config";
            if (interactive && action === "config") {
                if (!(await showDashboard("mode"))) {
                    await fallbackModePanel();
                    await fallbackRunMenu("Settings");
                }
                return;
            }
            show(await h.serial(() => h.command(action, parts, {
                cwd: ctx.cwd,
                trusted: ctx.isProjectTrusted(),
                hostContext: ctx,
                commandContext: ctx,
                signal: ctx.signal,
            })));
        },
    });
    for (const t of tools)
        pi.registerTool({
            ...t,
            execute: async (callId, input, signal, onUpdate, ctx) => {
                await get(ctx);
                return t.execute(callId, input, signal, onUpdate, ctx);
            },
        });
    pi.on("before_agent_start", async (e, ctx) => {
        const h = await get(ctx);
        if (!h.config.enabled ||
            h.config.mode === "off" ||
            e.messageType !== "user")
            return;
        const value = await h.serial(() => h.service.prompt?.(e.prompt, ctx) ?? Promise.resolve(undefined));
        if (value !== undefined)
            return {
                message: {
                    customType: extension,
                    content: JSON.stringify(redact(value)),
                    display: false,
                },
            };
    });
    pi.on("tool_call", async (e, ctx) => {
        const h = await get(ctx);
        if (h.config.enabled)
            return h.serial(() => h.service.toolCall?.(e, ctx) ?? Promise.resolve(undefined));
    });
    pi.on("tool_result", async (e, ctx) => {
        const h = await get(ctx);
        if (h.config.enabled)
            await h.serial(() => h.service.toolResult?.(e, ctx) ?? Promise.resolve());
    });
    pi.on("message_end", async (e, ctx) => {
        const h = await get(ctx);
        if (h.config.enabled)
            await h.serial(() => h.service.messageEnd?.(e, ctx) ?? Promise.resolve());
    });
    pi.on("agent_before_settle", async (e, ctx) => {
        const h = await get(ctx);
        if (!h.config.enabled || h.config.mode === "observe")
            return;
        return (await h.serial(() => h.service.settle?.(e, ctx) ?? Promise.resolve(undefined)));
    });
    return { get };
}
