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
  private calendars: any[];

  constructor() {
    if (!process.env.CALDAV_BASE_URL) {
      throw new Error('CALDAV_BASE_URL environment variable is required');
    }
    this.calendars = [];
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
    this.calendars = calendars;
    log('Found calendars:', calendars.map((c: { displayName: string }) => c.displayName).join(', '));
  }

  private getCalendar(calendarName?: string) {
    if (!calendarName) {
      return this.calendars[0];
    }
    const calendar = this.calendars.find(cal => cal.displayName === calendarName);
    if (!calendar) {
      throw new Error(`Calendar "${calendarName}" not found`);
    }
    return calendar;
  }

  async listCalendars() {
    return this.calendars.map((cal: { displayName: string; url: string; description?: string; components?: string[]; timezone?: string; calendarColor?: string }) => 
      `Calendar: ${cal.displayName}\n` +
      `URL: ${cal.url}\n` +
      `Description: ${cal.description || 'No description'}\n` +
      `Components: ${cal.components?.join(', ') || 'Not specified'}\n` +
      `Timezone: ${cal.timezone || 'Not specified'}\n` +
      `Color: ${cal.calendarColor || 'Not specified'}\n` +
      '---'
    ).join('\n');
  }

  async createEvent(summary: string, start: string, end: string, timezone: string, recurrence?: string, location?: string, calendarName?: string, reminders?: { action: 'DISPLAY' | 'AUDIO' | 'EMAIL', trigger: string, description?: string }[]) {
    log('Creating event with parameters:', { summary, start, end, timezone, recurrence, location, calendarName, reminders });
    
    const calendar = this.getCalendar(calendarName);
    log('Selected calendar:', { displayName: calendar.displayName, url: calendar.url });
    
    // Log the full calendar object to see all available properties
    log('Full calendar object:', JSON.stringify(calendar, null, 2));
    
    const formatDate = (date: string) => {
      const d = new Date(date);
      // Format as YYYYMMDDTHHMMSS without timezone conversion
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `TZID=${timezone}:${year}${month}${day}T${hours}${minutes}${seconds}`;
    };

    // Generate VALARM components for reminders
    const alarmComponents = reminders?.map(reminder => {
      const action = reminder.action === 'DISPLAY' ? 'DISPLAY' : reminder.action === 'AUDIO' ? 'AUDIO' : 'EMAIL';
      const description = reminder.description ? `\nDESCRIPTION:${reminder.description}` : '';
      return `BEGIN:VALARM
ACTION:${action}
TRIGGER:${reminder.trigger}${description}
END:VALARM`;
    }).join('\n') || '';

    const iCalString = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tsdav//tsdav 1.0.0//EN
BEGIN:VEVENT
SUMMARY:${summary}
DTSTART;${formatDate(start)}
DTEND;${formatDate(end)}${recurrence ? `\nRRULE:${recurrence}` : ''}${location ? `\nLOCATION:${location}` : ''}${alarmComponents ? `\n${alarmComponents}` : ''}
END:VEVENT
END:VCALENDAR`;

    log('Generated iCal string:', iCalString);
    
    // Construct the full URL that will be used
    const filename = `${encodeURIComponent(summary)}-${Date.now()}.ics`;
    const fullUrl = new URL(filename, calendar.url).toString();
    log('Full URL that will be used:', fullUrl);
    
    log('Attempting to create calendar object with:', { 
      calendarUrl: calendar.url,
      filename,
      fullUrl
    });

    try {
      const event = await this.client.createCalendarObject({
        calendar,
        filename,
        iCalString
      });
      log('Successfully created calendar object:', { url: event.url });
      return event.url;
    } catch (error) {
      log('Error creating calendar object:', error);
      // Log additional error details if available
      if (error instanceof Error) {
        log('Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
      }
      throw error;
    }
  }

  async listEvents(start: string, end: string, calendarName?: string) {
    const calendar = this.getCalendar(calendarName);
    calendarLog('Fetching events between %s and %s from calendar %s', start, end, calendar.displayName);
    
    const calendarObjects = await this.client.fetchCalendarObjects({
      calendar,
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
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/).describe(
          "The start time of the event in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-20T15:30:00\n" +
          "Note: The timezone will be applied from the timezone parameter."
        ),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/).describe(
          "The end time of the event in ISO 8601 format.\n" +
          "Examples:\n" +
          "- 2024-03-20T16:30:00\n" +
          "Note: The timezone will be applied from the timezone parameter."
        ),
        timezone: z.string().describe(
          "The timezone for the event.\n" +
          "Examples:\n" +
          "- America/New_York\n" +
          "- Europe/London\n" +
          "- Asia/Tokyo\n" +
          "Must be a valid IANA timezone name."
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
        ),
        calendarName: z.string().optional().describe(
          "Optional name of the calendar to create the event in.\n" +
          "If not specified, uses the first available calendar.\n" +
          "Use list-calendars to see available calendar names."
        ),
        reminders: z.array(z.object({
          action: z.enum(['DISPLAY', 'AUDIO', 'EMAIL']).describe(
            "The type of reminder action.\n" +
            "- DISPLAY: Shows a notification\n" +
            "- AUDIO: Plays a sound\n" +
            "- EMAIL: Sends an email"
          ),
          trigger: z.string().describe(
            "When the reminder should trigger.\n" +
            "Examples:\n" +
            "- -PT15M (15 minutes before)\n" +
            "- -PT1H (1 hour before)\n" +
            "- -P1D (1 day before)\n" +
            "- 20240320T100000Z (specific date/time)"
          ),
          description: z.string().optional().describe(
            "Optional description for the reminder.\n" +
            "For DISPLAY and EMAIL actions, this will be shown in the notification/email."
          )
        })).optional().describe(
          "Optional array of reminders for the event.\n" +
          "Each reminder can have a different action and trigger time."
        )
      },
      async ({summary, start, end, timezone, recurrence, location, calendarName, reminders}) => {
        const eventUrl = await calendarService.createEvent(summary, start, end, timezone, recurrence, location, calendarName, reminders);
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
        ),
        calendarName: z.string().optional().describe(
          "Optional name of the calendar to list events from.\n" +
          "If not specified, uses the first available calendar.\n" +
          "Use list-calendars to see available calendar names."
        )
      },
      async ({start, end, calendarName}) => {
        const events = await calendarService.listEvents(start, end, calendarName);
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