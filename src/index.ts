#!/usr/bin/env node

import 'dotenv/config'
import { createDAVClient, DAVCalendarObject } from 'tsdav';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import debug from 'debug';

const log = debug('caldav-mcp:main');
const calendarLog = debug('caldav-mcp:calendar');

// Core calendar functionality that can be used by both CLI and HTTP interfaces
export class CalendarService {
  private client: any;
  private calendar: any;

  constructor() {
    if (!process.env.CALDAV_BASE_URL) {
      throw new Error('CALDAV_BASE_URL environment variable is required');
    }
  }

  async initialize() {
    // Create a proxy for fetch that intercepts the well-known lookup
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      console.error('Intercepted fetch request:', input);
      if (typeof input === 'string' && input.includes('/.well-known/caldav')) {
        const baseUrl = process.env.CALDAV_BASE_URL;
        if (!baseUrl) {
          throw new Error('CALDAV_BASE_URL environment variable is required');
        }
        console.error('Intercepted well-known lookup, redirecting to:', baseUrl);
        return new Response(null, {
          status: 302,
          headers: {
            'Location': baseUrl
          }
        });
      }
      return originalFetch(input, init);
    };

    // Restore original fetch
    global.fetch = originalFetch;

    const baseUrl = process.env.CALDAV_BASE_URL;
    if (!baseUrl) {
      throw new Error('CALDAV_BASE_URL environment variable is required');
    }

    this.client = await createDAVClient({
      serverUrl: baseUrl,
      credentials: {
        username: process.env.CALDAV_USERNAME || "",
        password: process.env.CALDAV_PASSWORD || "",
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    const calendars = await this.client.fetchCalendars();
    if (!calendars || calendars.length === 0) {
      throw new Error('No calendars found');
    }
    this.calendar = calendars[0];
    log('Using calendar:', this.calendar.displayName);
  }

  async listCalendars() {
    const calendars = await this.client.fetchCalendars();
    return calendars.map((cal: { displayName: string; url: string; description?: string; components?: string[]; timezone?: string; calendarColor?: string }) => 
      `Calendar: ${cal.displayName}\n` +
      `URL: ${cal.url}\n` +
      `Description: ${cal.description || 'No description'}\n` +
      `Components: ${cal.components?.join(', ') || 'Not specified'}\n` +
      `Timezone: ${cal.timezone || 'Not specified'}\n` +
      `Color: ${cal.calendarColor || 'Not specified'}\n` +
      '---'
    ).join('\n');
  }

  async createEvent(summary: string, start: string, end: string, recurrence?: string) {
    const event = await this.client.createCalendarObject({
      calendar: this.calendar,
      filename: `${summary}-${Date.now()}.ics`,
      iCalString: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tsdav//tsdav 1.0.0//EN
BEGIN:VEVENT
SUMMARY:${summary}
DTSTART:${new Date(start).toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTEND:${new Date(end).toISOString().replace(/[-:]/g, '').split('.')[0]}Z${recurrence ? `\nRRULE:${recurrence}` : ''}
END:VEVENT
END:VCALENDAR`
    });
    return event.url;
  }

  async listEvents(start: string, end: string) {
    calendarLog('Fetching events between %s and %s', start, end);
    
    const calendarObjects = await this.client.fetchCalendarObjects({
      calendar: this.calendar,
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

        // Handle both timezone-aware and all-day events
        const startMatch = event.data.match(/DTSTART(?:;TZID=([^:]+))?(?:;VALUE=DATE)?:([^\n]+)/);
        const endMatch = event.data.match(/DTEND(?:;TZID=([^:]+))?(?:;VALUE=DATE)?:([^\n]+)/);
        const summaryMatch = event.data.match(/SUMMARY:([^\n]+)/);

        if (!startMatch || !endMatch || !summaryMatch) {
          calendarLog('Could not parse event data');
          return false;
        }

        const startTz = startMatch[1];
        const endTz = endMatch[1];
        const startDateStr = startMatch[2];
        const endDateStr = endMatch[2];
        const isAllDay = event.data.includes('VALUE=DATE');

        let startUTC: Date;
        let endUTC: Date;

        if (isAllDay) {
          startUTC = new Date(startDateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
          endUTC = new Date(endDateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
          endUTC.setDate(endUTC.getDate() - 1);
        } else {
          // For timezone-aware dates, we need to parse the date string and timezone separately
          const dateStr = startDateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
          startUTC = new Date(dateStr);
          if (startTz) {
            // Adjust for timezone offset
            const tzOffset = new Date().getTimezoneOffset();
            startUTC.setMinutes(startUTC.getMinutes() + tzOffset);
          }

          const endDateStr = endMatch[2];
          const endDateStrFormatted = endDateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
          endUTC = new Date(endDateStrFormatted);
          if (endTz) {
            // Adjust for timezone offset
            const tzOffset = new Date().getTimezoneOffset();
            endUTC.setMinutes(endUTC.getMinutes() + tzOffset);
          }
        }
        
        return startUTC <= endDate && endUTC >= startDate;
      } catch (error) {
        calendarLog('Error processing event: %s', error);
        return false;
      }
    });

    calendarLog('Found %d events in date range', filteredEvents.length);

    return filteredEvents.map((e: DAVCalendarObject) => {
      try {
        if (!e.data) {
          calendarLog('Event data is undefined or null');
          return 'Error: Event data is missing';
        }
        const startMatch = e.data.match(/DTSTART(?:;TZID=([^:]+))?(?:;VALUE=DATE)?:([^\n]+)/);
        const endMatch = e.data.match(/DTEND(?:;TZID=([^:]+))?(?:;VALUE=DATE)?:([^\n]+)/);
        const summaryMatch = e.data.match(/SUMMARY:([^\n]+)/);

        if (!startMatch || !endMatch || !summaryMatch) {
          return 'Error: Could not parse event data';
        }

        const startTz = startMatch[1];
        const endTz = endMatch[1];
        const startDateStr = startMatch[2];
        const endDateStr = endMatch[2];
        const summary = summaryMatch[1];
        const isAllDay = e.data.includes('VALUE=DATE');

        const formatDate = (dateStr: string, tz?: string, isAllDay: boolean = false) => {
          if (isAllDay) {
            // For all-day events, format as YYYY-MM-DD
            return dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
          } else {
            // For regular events, format as YYYY-MM-DDTHH:mm:ss
            const formatted = dateStr.replace(
              /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
              '$1-$2-$3T$4:$5:$6'
            );
            return tz ? `${formatted} (${tz})` : formatted;
          }
        };

        const start = formatDate(startDateStr, startTz, isAllDay);
        const end = formatDate(endDateStr, endTz, isAllDay);
        
        return `${summary}${isAllDay ? ' (All Day)' : ''}\nStart: ${start}\nEnd: ${end}`;
      } catch (error) {
        calendarLog('Error formatting event: %s', error);
        return 'Error processing event data';
      }
    }).join("\n");
  }
}

// CLI-specific code
async function main() {
  // Log environment variables (without sensitive data)
  console.error('Environment check:');
  console.error('CALDAV_BASE_URL:', process.env.CALDAV_BASE_URL ? 'Set' : 'Not set');
  console.error('CALDAV_USERNAME:', process.env.CALDAV_USERNAME ? 'Set' : 'Not set');
  console.error('CALDAV_PASSWORD:', process.env.CALDAV_PASSWORD ? 'Set' : 'Not set');

  try {
    const calendarService = new CalendarService();
    await calendarService.initialize();

    const server = new McpServer({
      name: "caldav-mcp",
      version: "0.1.0"
    });

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
        )
      },
      async ({summary, start, end, recurrence}) => {
        const eventUrl = await calendarService.createEvent(summary, start, end, recurrence);
        return {
          content: [{type: "text", text: eventUrl}]
        };
      }
    );

    server.tool(
      "list-events",
      {
        start: z.string().datetime().describe(
          "The start of the time range to search for events in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-20T00:00:00Z (UTC time)\n" +
          "- 2024-03-20T00:00:00+00:00 (UTC time with offset)\n" +
          "- 2024-03-20T00:00:00-05:00 (Eastern Time)"
        ),
        end: z.string().datetime().describe(
          "The end of the time range to search for events in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-21T00:00:00Z (UTC time)\n" +
          "- 2024-03-21T00:00:00+00:00 (UTC time with offset)\n" +
          "- 2024-03-21T00:00:00-05:00 (Eastern Time)"
        )
      },
      async ({start, end}) => {
        const events = await calendarService.listEvents(start, end);
        return {
          content: [{type: "text", text: events}]
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