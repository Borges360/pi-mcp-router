import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Host, Service, CommandContext } from "./common/runtime.js";
export interface ToolCandidate {
    server: string;
    name: string;
    readOnly: boolean;
    destructive: boolean;
    openWorld: boolean;
    trusted: boolean;
    available: boolean;
}
export interface CapabilityDefinition {
    schemaVersion: 1;
    id: string;
    description: string;
    keywords: string[];
    allowed: boolean;
    candidates: ToolCandidate[];
}
export interface CapabilityRequest {
    schemaVersion: 1;
    capabilities: string[];
    reasons?: Record<string, string>;
}
export interface ToolExposureDecision {
    schemaVersion: 1;
    capabilities: string[];
    servers: string[];
    tools: string[];
    denied: Array<{
        capability: string;
        reason: string;
    }>;
}
export interface Approval {
    schemaVersion: 1;
    id: string;
    tool: string;
    server: string;
    taskId: string;
    argumentsHash: string;
    expiresAt: number;
    consumed: boolean;
}
export interface DurableTaskAdapter {
    supportsTasks: boolean;
    submit(tool: string, args: unknown, key: string, signal?: AbortSignal): Promise<{
        taskId: string;
        status: string;
    }>;
    poll(taskId: string, signal?: AbortSignal): Promise<{
        status: string;
        result?: unknown;
    }>;
}
export declare function validateCapability(input: unknown): CapabilityDefinition;
export declare function routeCapabilities(requested: string[], catalog: CapabilityDefinition[], limits: {
    maxServers: number;
    maxTools: number;
}): ToolExposureDecision;
export declare function approvalValid(approval: Approval | undefined, tool: string, server: string, taskId: string, args: unknown): boolean;
export declare class McpRouter implements Service {
    readonly host: Host;
    modeDescriptions: {
        auto: string;
        observe: string;
        off: string;
    };
    menuGroups: {
        Capabilities: string[];
        Servers: string[];
        Tools: string[];
        Settings: string[];
    };
    capabilities: string[];
    menu: string[];
    catalog: CapabilityDefinition[];
    decision?: ToolExposureDecision;
    private taskId;
    private originalTools;
    private managed;
    private discoveredServers;
    private legacyRegistrationCount;
    private failures;
    private activeTask?;
    constructor(host: Host);
    start(): Promise<void>;
    refresh(): void;
    close(): Promise<void>;
    route(requested: string[]): Promise<ToolExposureDecision>;
    prompt(text: string): Promise<{
        mcp: ToolExposureDecision;
    } | undefined>;
    toolCall(raw: unknown, ctx: ExtensionContext): Promise<{
        block: true;
        reason: string;
    } | undefined>;
    toolResult(raw: unknown): Promise<void>;
    durable(adapter: DurableTaskAdapter, tool: string, args: unknown, signal?: AbortSignal): Promise<{
        taskId: string;
        status: string;
    } | {
        taskId: string;
        status: string;
        pending: boolean;
    }>;
    pollDurable(adapter: DurableTaskAdapter, tool: string, args: unknown, signal?: AbortSignal): Promise<{
        taskId: string;
        status: string;
        evidenceRef?: string;
    }>;
    command(action: string, args: string[], context: CommandContext): Promise<unknown>;
}
export declare const createService: (host: Host) => McpRouter;
