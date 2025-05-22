#!/usr/bin/env node

import 'dotenv/config'
import { createDAVClient, DAVCalendarObject } from 'tsdav';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "caldav-mcp",
  version: "0.1.0"
});

async function main() {
  // Create a proxy for fetch that intercepts the well-known lookup
  const originalFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    console.log('Intercepted fetch request:', input);
    if (typeof input === 'string' && input.includes('/.well-known/caldav')) {
      console.log('Intercepted well-known lookup, redirecting to:', process.env.CALDAV_BASE_URL);
      // Return a mock response that redirects to our base URL
      return new Response(null, {
        status: 302,
        headers: {
          'Location': process.env.CALDAV_BASE_URL || ''
        }
      });
    }
    return originalFetch(input, init);
  };

  const client = await createDAVClient({
    serverUrl: process.env.CALDAV_BASE_URL || "",
    credentials: {
      username: process.env.CALDAV_USERNAME || "",
      password: process.env.CALDAV_PASSWORD || "",
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  // Restore original fetch
  global.fetch = originalFetch;

  const calendars = await client.fetchCalendars();
  const calendar = calendars[0];

  server.tool(
    "create-event",
    {summary: z.string(), start: z.string().datetime(), end: z.string().datetime()},
    async ({summary, start, end}) => {
      const event = await client.createCalendarObject({
        calendar: calendar,
        filename: `${summary}-${Date.now()}.ics`,
        iCalString: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tsdav//tsdav 1.0.0//EN
BEGIN:VEVENT
SUMMARY:${summary}
DTSTART:${new Date(start).toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTEND:${new Date(end).toISOString().replace(/[-:]/g, '').split('.')[0]}Z
END:VEVENT
END:VCALENDAR`
      });
      return {
        content: [{type: "text", text: event.url}]
      };
    }
  );

  server.tool(
    "list-events",
    {start: z.string().datetime(), end: z.string().datetime()},
    async ({start, end}) => {
      const calendarObjects = await client.fetchCalendarObjects({
        calendar: calendar,
      });

      // Filter events that fall within the specified time range
      const startDate = new Date(start);
      const endDate = new Date(end);

      const filteredEvents = calendarObjects.filter((event: DAVCalendarObject) => {
        const eventStart = new Date(event.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, ''));
        const eventEnd = new Date(event.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, ''));
        const summary = event.data.split('SUMMARY:')[1].split('\n')[0];

        // Event starts before the end time and ends after the start time
        return eventStart <= endDate && eventEnd >= startDate;
      });

      return {
        content: [{type: "text", text: filteredEvents.map((e: DAVCalendarObject) => {
          const summary = e.data.split('SUMMARY:')[1].split('\n')[0];
          const start = e.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, '');
          const end = e.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, '');
          return `${summary}\nStart: ${start}\nEnd: ${end}`;
        }).join("\n")}]
      };
    }
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main()