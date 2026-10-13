#!/usr/bin/env node
import { cli } from "./common/cli.js";
import { createService } from "./mcp.js";
await cli("pi-mcp-router", createService);
