import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fetch } from "undici";

// Polyfill fetch for node
global.fetch = fetch as any;

async function main() {
    console.log("Connecting to MCP server at http://localhost:3000/mcp...");
    const transport = new SSEClientTransport(new URL("http://localhost:3000/mcp"));
    const client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: { resources: {} } }
    );

    await client.connect(transport);
    console.log("Connected!");

    const resources = await client.request({ method: "resources/list" }, z.any());
    console.log("RESOURCES:");
    console.log(JSON.stringify(resources, null, 2));

    const tools = await client.request({ method: "tools/list" }, z.any());
    console.log("TOOLS:");
    console.log(JSON.stringify(tools, null, 2));

    process.exit(0);
}

main().catch(console.error);
