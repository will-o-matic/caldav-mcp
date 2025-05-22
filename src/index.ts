#!/usr/bin/env node

import 'dotenv/config'
import { createDAVClient, DAVCalendarObject } from 'tsdav';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import debug from 'debug';

const log = debug('caldav-mcp:main');
const calendarLog = debug('caldav-mcp:calendar');

const server = new McpServer({
  name: "caldav-mcp",
  version: "0.1.0"
});

async function main() {
  // Log environment variables (without sensitive data)
  console.error('Environment check:');
  console.error('CALDAV_BASE_URL:', process.env.CALDAV_BASE_URL ? 'Set' : 'Not set');
  console.error('CALDAV_USERNAME:', process.env.CALDAV_USERNAME ? 'Set' : 'Not set');
  console.error('CALDAV_PASSWORD:', process.env.CALDAV_PASSWORD ? 'Set' : 'Not set');

  if (!process.env.CALDAV_BASE_URL) {
    throw new Error('CALDAV_BASE_URL environment variable is required');
  }

  // Create a proxy for fetch that intercepts the well-known lookup
  const originalFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    console.error('Intercepted fetch request:', input);
    if (typeof input === 'string' && input.includes('/.well-known/caldav')) {
      console.error('Intercepted well-known lookup, redirecting to:', process.env.CALDAV_BASE_URL);
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

  try {
    const client = await createDAVClient({
      serverUrl: process.env.CALDAV_BASE_URL,
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
    if (!calendars || calendars.length === 0) {
      throw new Error('No calendars found');
    }
    const calendar = calendars[0];
    log('Using calendar:', calendar.displayName);

    server.tool(
      "list-calendars",
      {},
      async () => {
        const calendars = await client.fetchCalendars();
        return {
          content: [{type: "text", text: calendars.map(cal => 
            `Calendar: ${cal.displayName}\n` +
            `URL: ${cal.url}\n` +
            `Description: ${cal.description || 'No description'}\n` +
            `Components: ${cal.components?.join(', ') || 'Not specified'}\n` +
            `Timezone: ${cal.timezone || 'Not specified'}\n` +
            `Color: ${cal.calendarColor || 'Not specified'}\n` +
            '---'
          ).join('\n')}]
        };
      }
    );

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
        calendarLog('Fetching events between %s and %s', start, end);
        
        const calendarObjects = await client.fetchCalendarObjects({
          calendar: calendar,
        });
        
        calendarLog('Retrieved %d calendar objects', calendarObjects.length);
        
        const startDate = new Date(start);
        const endDate = new Date(end);
        calendarLog('Filtering events between %s and %s', startDate.toISOString(), endDate.toISOString());

        const filteredEvents = calendarObjects.filter((event: DAVCalendarObject) => {
          try {
            calendarLog('Processing event data: %s', event.data);
            
            if (!event.data) {
              calendarLog('Event data is undefined or null');
              return false;
            }

            const eventStart = new Date(event.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, ''));
            const eventEnd = new Date(event.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, ''));
            const summary = event.data.split('SUMMARY:')[1].split('\n')[0];
            
            calendarLog('Event details - Summary: %s, Start: %s, End: %s', 
              summary, eventStart.toISOString(), eventEnd.toISOString());

            return eventStart <= endDate && eventEnd >= startDate;
          } catch (error) {
            calendarLog('Error processing event: %s', error);
            return false;
          }
        });

        calendarLog('Found %d events in date range', filteredEvents.length);

        return {
          content: [{type: "text", text: filteredEvents.map((e: DAVCalendarObject) => {
            try {
              if (!e.data) {
                calendarLog('Event data is undefined or null');
                return 'Error: Event data is missing';
              }
              const summary = e.data.split('SUMMARY:')[1].split('\n')[0];
              const start = e.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, '');
              const end = e.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, '');
              return `${summary}\nStart: ${start}\nEnd: ${end}`;
            } catch (error) {
              calendarLog('Error formatting event: %s', error);
              return 'Error processing event data';
            }
          }).join("\n")}]
        };
      }
    );

    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});