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
      {
        summary: z.string().describe("The title or summary of the calendar event"),
        start: z.string().datetime().describe(
          "The start time of the event in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-20T15:30:00Z (UTC time)\n" +
          "- 2024-03-20T15:30:00+00:00 (UTC time with offset)\n" +
          "- 2024-03-20T15:30:00-05:00 (Eastern Time)"
        ),
        end: z.string().datetime().describe(
          "The end time of the event in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-20T16:30:00Z (UTC time)\n" +
          "- 2024-03-20T16:30:00+00:00 (UTC time with offset)\n" +
          "- 2024-03-20T16:30:00-05:00 (Eastern Time)"
        ),
        recurrence: z.string().optional().describe(
          "Optional recurrence rule in iCalendar RRULE format.\n" +
          "Examples:\n" +
          "- FREQ=DAILY (daily recurrence)\n" +
          "- FREQ=WEEKLY;BYDAY=MO,WE,FR (every Monday, Wednesday, Friday)\n" +
          "- FREQ=MONTHLY;BYDAY=1MO (first Monday of each month)\n" +
          "- FREQ=YEARLY;COUNT=5 (yearly for 5 occurrences)\n" +
          "- FREQ=WEEKLY;UNTIL=20241231T235959Z (weekly until end of 2024)"
        ),
        location: z.string().optional().describe(
          "Optional location for the event.\n" +
          "Examples:\n" +
          "- Conference Room A\n" +
          "- 123 Main St, City, State\n" +
          "- Virtual Meeting (Zoom)\n" +
          "- Building 4, Floor 2"
        )
      },
      async ({summary, start, end, recurrence, location}) => {
        const eventUrl = await calendarService.createEvent(summary, start, end, recurrence, location);
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