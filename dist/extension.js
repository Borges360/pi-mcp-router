import { Type } from "typebox";
import { register, toolResult } from "./common/runtime.js";
import { createService } from "./mcp.js";
export default function (pi) {
    const runtime = register(pi, "pi-mcp-router", "mcprouter", createService);
    pi.registerTool({
        name: "mcprouter_select",
        label: "Select MCP capabilities",
        description: "Expose a minimal set of explicitly permitted MCP capabilities; cannot grant permissions.",
        parameters: Type.Object({ capabilities: Type.Array(Type.String()) }),
        execute: async (_id, input, _signal, _update, ctx) => {
            const h = await runtime.get(ctx);
            return h.serial(async () => toolResult(await h.service.route(input.capabilities)));
        },
    });
}
