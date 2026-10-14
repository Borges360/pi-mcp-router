import { readFile } from "node:fs/promises";
import { canonical, contained, digest, id, now, bound, redact, } from "./common/security.js";
export function normalizeServerRegistration(value) {
    const server = value;
    if (!server ||
        !/^[-a-zA-Z0-9_]+$/.test(server.id) ||
        typeof server.url !== "string")
        throw new Error("invalid-server-registration");
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) => /token|secret|password|api.?key/i.test(key)))
        throw new Error("credentials-must-use-header-environment-references");
    const headers = Array.isArray(server.headerEnv)
        ? server.headerEnv
        : Object.entries(server.headerEnv ?? {}).map(([header, variable]) => ({
            header,
            variable,
        }));
    for (const field of headers)
        if (!/^[a-zA-Z0-9-]+$/.test(field.header) ||
            !/^[A-Z][A-Z0-9_]*$/.test(field.variable) ||
            (field.prefix !== undefined &&
                !["Bearer ", "Basic ", ""].includes(field.prefix)))
            throw new Error("invalid-header-environment-reference");
    return {
        schemaVersion: 1,
        id: server.id,
        url: url.toString(),
        headerEnv: headers,
    };
}
export function validateCapability(input) {
    const c = input;
    if (c?.schemaVersion !== 1 ||
        !/^[-a-zA-Z0-9.]+$/.test(c.id) ||
        typeof c.description !== "string" ||
        typeof c.allowed !== "boolean" ||
        !Array.isArray(c.keywords) ||
        c.keywords.some((k) => typeof k !== "string") ||
        !Array.isArray(c.candidates) ||
        !c.candidates.length)
        throw new Error("invalid-capability");
    for (const t of c.candidates)
        if (typeof t.server !== "string" ||
            typeof t.name !== "string" ||
            typeof t.readOnly !== "boolean" ||
            typeof t.destructive !== "boolean" ||
            typeof t.openWorld !== "boolean" ||
            typeof t.trusted !== "boolean" ||
            typeof t.available !== "boolean")
            throw new Error("invalid-tool-policy");
    return c;
}
export function routeCapabilities(requested, catalog, limits) {
    const result = {
        schemaVersion: 1,
        capabilities: [],
        servers: [],
        tools: [],
        denied: [],
    };
    const servers = new Set(), tools = new Set();
    for (const key of [...new Set(requested)]) {
        const c = catalog.find((x) => x.id === key);
        if (!c) {
            result.denied.push({ capability: key, reason: "unknown-capability" });
            continue;
        }
        if (!c.allowed) {
            result.denied.push({ capability: key, reason: "policy-denied" });
            continue;
        }
        const candidates = c.candidates
            .filter((t) => t.available && t.trusted)
            .sort((a, b) => Number(b.readOnly) - Number(a.readOnly) ||
            Number(servers.has(b.server)) - Number(servers.has(a.server)) ||
            a.name.localeCompare(b.name));
        const candidate = candidates.find((t) => (servers.has(t.server) || servers.size < limits.maxServers) &&
            (tools.has(t.name) || tools.size < limits.maxTools));
        if (!candidate) {
            result.denied.push({
                capability: key,
                reason: candidates.length
                    ? "surface-limit"
                    : "unavailable-or-untrusted",
            });
            continue;
        }
        result.capabilities.push(key);
        servers.add(candidate.server);
        tools.add(candidate.name);
    }
    result.servers = [...servers];
    result.tools = [...tools];
    return result;
}
export function approvalValid(approval, tool, server, taskId, args) {
    return (!!approval &&
        approval.schemaVersion === 1 &&
        !approval.consumed &&
        approval.expiresAt > Date.now() &&
        approval.tool === tool &&
        approval.server === server &&
        approval.taskId === taskId &&
        approval.argumentsHash === digest(args));
}
export class McpRouter {
    host;
    modeDescriptions = {
        auto: "Expose locally authorized tools that match the current task.",
        observe: "Show capability decisions without changing active tools.",
        off: "Disable automatic MCP tool selection.",
    };
    menuGroups = {
        Capabilities: ["status"],
        Servers: ["servers"],
        Tools: ["tools", "explain"],
        Settings: ["config", "doctor"],
    };
    capabilities = ["mcp.capability-route.v1", "mcp.policy.v1"];
    menu = ["status", "capabilities", "servers", "tools", "explain", "auto"];
    catalog = [];
    decision;
    taskId = "idle";
    originalTools = [];
    managed = new Set();
    registered = new Set();
    failures = new Set();
    activeTask;
    constructor(host) {
        this.host = host;
    }
    async start() {
        for (const server of await this.host.store.listRecords("server-registry"))
            this.registerServer(server);
        this.originalTools = this.host.api?.getActiveTools() ?? [];
        this.catalog = (await this.host.store.listRecords("capabilities")).map(validateCapability);
        this.host.interop.listen("pi.task.started.v1", (e) => {
            const p = e.payload;
            if (p.taskId) {
                this.taskId = p.taskId;
                this.activeTask = { id: p.taskId, capabilities: p.capabilities ?? [] };
                if (Array.isArray(p.capabilities))
                    void this.host.serial(() => this.route(p.capabilities));
            }
        });
        this.host.interop.listen("pi.task.updated.v1", (event) => {
            const payload = event.payload;
            if (payload.taskId === this.activeTask?.id &&
                ["accepted", "failed", "cancelled"].includes(payload.status))
                this.activeTask = undefined;
        });
        this.refresh();
    }
    registerServer(input) {
        const server = normalizeServerRegistration(input);
        if (!this.host.api)
            return;
        const headers = {};
        for (const { header, variable, prefix } of server.headerEnv) {
            if (!process.env[variable])
                throw new Error("server-credential-env-unavailable");
            headers[header] = (prefix ?? "") + process.env[variable];
        }
        this.host.api.registerMcpServer(server.id, {
            url: server.url,
            headers,
            exposure: "deferred",
        });
        this.registered.add(server.id);
    }
    refresh() {
        const api = this.host.api;
        if (!api)
            return;
        const all = api.getAllTools();
        this.managed = new Set(all
            .filter((t) => t.name.startsWith("mcp__") || t.namespace?.name.startsWith("mcp__"))
            .map((t) => t.name));
        for (const c of this.catalog)
            for (const t of c.candidates) {
                this.managed.add(t.name);
                t.available =
                    all.some((a) => a.name === t.name) &&
                        !this.failures.has(this.taskId + ":" + t.name);
            }
    }
    async close() {
        if (this.host.api) {
            const active = this.host.api.getActiveTools();
            this.host.api.setActiveTools([
                ...new Set([
                    ...active.filter((t) => !this.managed.has(t)),
                    ...this.originalTools.filter((t) => this.managed.has(t)),
                ]),
            ]);
            for (const server of this.registered)
                this.host.api.unregisterMcpServer(server);
        }
        this.registered.clear();
    }
    async route(requested) {
        this.refresh();
        this.decision = routeCapabilities(requested, this.catalog, {
            maxServers: this.host.config.maxServersPerTask,
            maxTools: this.host.config.maxDirectTools,
        });
        await this.host.store.putRecord("decisions", id(), {
            ...this.decision,
            taskId: this.taskId,
            createdAt: now(),
        });
        if (this.host.api && this.host.config.mode === "auto")
            this.host.api.setActiveTools([
                ...new Set([
                    ...this.host.api.getActiveTools().filter((t) => !this.managed.has(t)),
                    ...this.decision.tools,
                ]),
            ]);
        this.host.interop.emit("pi.mcp.selection.v1", this.decision, {
            taskId: this.taskId,
            correlationId: this.taskId,
        });
        return this.decision;
    }
    async prompt(text) {
        this.taskId = this.activeTask?.id ?? digest(text);
        const requested = this.catalog
            .filter((c) => c.keywords.some((w) => text.toLowerCase().includes(w.toLowerCase())))
            .map((c) => c.id);
        const decision = await this.route([
            ...new Set([...(this.activeTask?.capabilities ?? []), ...requested]),
        ]);
        return requested.length ? { mcp: decision } : undefined;
    }
    async toolCall(raw, ctx) {
        const e = raw;
        if (!this.managed.has(e.toolName) && !e.toolName.startsWith("mcp__"))
            return undefined;
        const candidate = this.catalog
            .flatMap((c) => c.candidates)
            .find((c) => c.name === e.toolName);
        const deny = async (reason) => {
            await this.host.store.putRecord("denials", id(), {
                tool: e.toolName,
                taskId: this.taskId,
                reason,
                createdAt: now(),
            });
            return { block: true, reason };
        };
        if (!candidate ||
            !candidate.available ||
            !candidate.trusted ||
            !this.decision?.tools.includes(e.toolName))
            return deny("mcp-default-deny");
        // Server annotations never relax these locally authored fields.
        if (!candidate.readOnly || candidate.destructive || candidate.openWorld) {
            const key = digest(this.taskId +
                ":" +
                candidate.server +
                ":" +
                e.toolName +
                ":" +
                canonical(e.input));
            let approval = await this.host.store.getRecord("approvals", key);
            if (!approvalValid(approval ?? undefined, e.toolName, candidate.server, this.taskId, e.input)) {
                if (!ctx.hasUI ||
                    !(await ctx.ui.confirm("Approve MCP operation?", JSON.stringify({
                        tool: e.toolName,
                        server: candidate.server,
                        arguments: e.input,
                    }))))
                    return deny("mcp-explicit-approval-required");
                approval = {
                    schemaVersion: 1,
                    id: key,
                    tool: e.toolName,
                    server: candidate.server,
                    taskId: this.taskId,
                    argumentsHash: digest(e.input),
                    expiresAt: Date.now() + 60000,
                    consumed: false,
                };
            }
            approval.consumed = true;
            await this.host.store.putRecord("approvals", key, approval);
        }
        return undefined;
    }
    async toolResult(raw) {
        const e = raw;
        if (!this.managed.has(e.toolName))
            return;
        await this.host.store.putRecord("tool-usage", id(), {
            tool: e.toolName,
            taskId: this.taskId,
            error: e.isError,
            createdAt: now(),
        });
        if (e.isError) {
            this.failures.add(this.taskId + ":" + e.toolName);
            for (const c of this.catalog)
                for (const t of c.candidates)
                    if (t.name === e.toolName)
                        t.available = false;
            this.decision.tools = this.decision.tools.filter((t) => t !== e.toolName);
            if (this.host.api)
                this.host.api.setActiveTools(this.host.api.getActiveTools().filter((t) => t !== e.toolName));
        }
    }
    async durable(adapter, tool, args, signal) {
        if (!adapter.supportsTasks)
            throw new Error("durable-tasks-unsupported");
        const key = digest(this.taskId + tool + canonical(args));
        const prior = await this.host.store.getRecord("remote-tasks", key);
        if (prior)
            return prior;
        if (await this.host.store.getRecord("remote-intents", key))
            throw new Error("needs-side-effect-review");
        await this.host.store.putRecord("remote-intents", key, {
            tool,
            key,
            status: "intent",
            replay: "never-automatic",
        });
        const handle = await adapter.submit(tool, args, key, signal);
        await this.host.store.putRecord("remote-tasks", key, handle);
        return { pending: true, ...handle };
    }
    async pollDurable(adapter, tool, args, signal) {
        if (!adapter.supportsTasks)
            throw new Error("durable-tasks-unsupported");
        const key = digest(this.taskId + tool + canonical(args));
        const prior = await this.host.store.getRecord("remote-tasks", key);
        if (!prior)
            throw new Error("remote-task-handle-required");
        if (["completed", "failed", "cancelled"].includes(prior.status))
            return prior;
        // Polling never resubmits an operation; a disconnected poll preserves the handle.
        const observation = await adapter.poll(prior.taskId, signal);
        if (![
            "working",
            "input_required",
            "completed",
            "failed",
            "cancelled",
        ].includes(observation.status))
            throw new Error("invalid-remote-task-status");
        let evidenceRef = prior.evidenceRef;
        if (observation.result !== undefined) {
            const blob = await this.host.store.writeBlob(id(), Buffer.from(bound(JSON.stringify(redact(observation.result)), this.host.config.maxEvidenceTokens)));
            evidenceRef = blob.id;
        }
        const record = {
            ...prior,
            status: observation.status,
            evidenceRef,
            updatedAt: now(),
        };
        await this.host.store.putRecord("remote-tasks", key, record);
        return record;
    }
    async command(action, args, context) {
        if (action === "status")
            return {
                decision: this.decision,
                capabilities: this.catalog.length,
                taskId: this.taskId,
            };
        if (action === "tools")
            return {
                selected: this.decision?.tools ?? [],
                managed: [...this.managed],
            };
        if (action === "servers") {
            if (args[0] === "add") {
                if (!args[1])
                    throw new Error("server-file-required");
                const server = normalizeServerRegistration(JSON.parse(await readFile(await contained(context.cwd, args[1]), "utf8")));
                this.registerServer(server);
                await this.host.store.putRecord("server-registry", server.id, server);
                return { registered: server.id };
            }
            return [
                ...new Set(this.catalog.flatMap((c) => c.candidates.map((t) => t.server))),
            ];
        }
        if (action === "explain")
            return this.decision ?? { reason: "no-capabilities-requested" };
        if (action === "capabilities") {
            if (args[0] === "add") {
                if (!args[1])
                    throw new Error("capability-file-required");
                const c = validateCapability(JSON.parse(await readFile(await contained(context.cwd, args[1]), "utf8")));
                await this.host.store.putRecord("capabilities", c.id, c);
                this.catalog = (await this.host.store.listRecords("capabilities")).map(validateCapability);
                return c;
            }
            return this.catalog;
        }
        if (action === "route" || action === "check")
            return this.route(args);
        if (action === "approve") {
            if (!args[0])
                throw new Error("approval-file-required");
            const p = JSON.parse(await readFile(await contained(context.cwd, args[0]), "utf8"));
            if (!p.tool || !p.server || p.taskId !== this.taskId)
                throw new Error("approval-task-scope-mismatch");
            const key = digest(p.taskId + ":" + p.server + ":" + p.tool + ":" + canonical(p.args));
            const approval = {
                schemaVersion: 1,
                id: key,
                tool: p.tool,
                server: p.server,
                taskId: p.taskId,
                argumentsHash: digest(p.args),
                expiresAt: Date.now() + 60000,
                consumed: false,
            };
            await this.host.store.putRecord("approvals", key, approval);
            return { approved: true, expiresAt: approval.expiresAt };
        }
        throw new Error("unknown-command:" + action);
    }
}
export const createService = (host) => new McpRouter(host);
