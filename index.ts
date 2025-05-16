import 'dotenv/config'
import { CalDAVClient } from "ts-caldav";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";


// Create an MCP server
const server = new McpServer({
  name: "Demo",
  version: "1.0.0"
});

async function main() {
  const client = await CalDAVClient.create({
    baseUrl: process.env.CALDAV_BASE_URL,
    auth: {
      type: "basic",
      username: process.env.CALDAV_USERNAME,
      password: process.env.CALDAV_PASSWORD
    }
  });

// List calendars
  const calendars = await client.getCalendars();

  const calendar = calendars[0];

// Fetch events
  const events = await client.getEvents(calendar.url);

  // console.log(events);

  //

  // Async tool with external API call
  server.tool(
    "create-event",
    {summary: z.string(), start: z.date(), end: z.date()},
    async ({summary, start, end}) => {
      const event = await client.createEvent(calendar.url, {
        summary: summary,
        start: start,
        end: end,
      });
      return {
        content: [{type: "text", text: event.uid}]
      };
    }
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main()