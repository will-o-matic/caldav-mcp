import 'dotenv/config'
import { CalDAVClient } from "ts-caldav";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "caldav-mcp",
  version: "0.1.0"
});

async function main() {
  const client = await CalDAVClient.create({
    baseUrl: process.env.CALDAV_BASE_URL || "",
    auth: {
      type: "basic",
      username: process.env.CALDAV_USERNAME || "",
      password: process.env.CALDAV_PASSWORD || ""
    }
  });

  const calendars = await client.getCalendars();
  const calendar = calendars[0];

  server.tool(
    "create-event",
    {summary: z.string(), start: z.string().datetime(), end: z.string().datetime()},
    async ({summary, start, end}) => {
      const event = await client.createEvent(calendar.url, {
        summary: summary,
        start: new Date(start),
        end: new Date(end),
      });
      return {
        content: [{type: "text", text: event.uid}]
      };
    }
  );

  server.tool(
    "list-events",
    {start: z.string().datetime(), end: z.string().datetime()},
    async ({start, end}) => {
      const allEvents = await client.getEvents(calendar.url);

      // Filter events that fall within the specified time range
      const startDate = new Date(start);
      const endDate = new Date(end);

      const filteredEvents = allEvents.filter(event => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        // Event starts before the end time and ends after the start time
        return eventStart <= endDate && eventEnd >= startDate;
      });

      return {
        content: [{type: "text", text: filteredEvents.map(e => `${e.summary}\nStart: ${e.start}\nEnd: ${e.end}`).join("\n")}]
      };
    }
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main()