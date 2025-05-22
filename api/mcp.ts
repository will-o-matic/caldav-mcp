import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CalendarService } from "../src/index.js";

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

export default async function handler(req: any, res: any) {
  // Check for existing session ID
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        transports[sessionId] = transport;
      }
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    const server = new McpServer({
      name: "caldav-mcp",
      version: "0.1.0"
    });

    const calendarService = new CalendarService();
    await calendarService.initialize();

    server.tool(
      "list-calendars",
      {},
      async () => {
        const calendars = await calendarService.listCalendars();
        return {
          content: [{type: "text", text: calendars}]
        };
      }
    );

    server.tool(
      "create-event",
      {summary: z.string(), start: z.string().datetime(), end: z.string().datetime()},
      async ({summary, start, end}) => {
        const eventUrl = await calendarService.createEvent(summary, start, end);
        return {
          content: [{type: "text", text: eventUrl}]
        };
      }
    );

    server.tool(
      "list-events",
      {start: z.string().datetime(), end: z.string().datetime()},
      async ({start, end}) => {
        const events = await calendarService.listEvents(start, end);
        return {
          content: [{type: "text", text: events}]
        };
      }
    );

    // Connect to the MCP server
    await server.connect(transport);
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
      id: null,
    });
    return;
  }

  // Handle the request
  await transport.handleRequest(req, res, req.body);
} 