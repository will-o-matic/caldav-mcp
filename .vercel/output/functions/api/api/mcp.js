import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createDAVClient } from 'tsdav';
import { z } from "zod";
import { randomUUID } from "node:crypto";
// Map to store transports by session ID
const transports = {};
export default async function handler(req, res) {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'];
    let transport;
    if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
    }
    else if (!sessionId && isInitializeRequest(req.body)) {
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
        // Create a proxy for fetch that intercepts the well-known lookup
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            if (typeof input === 'string' && input.includes('/.well-known/caldav')) {
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
        server.tool("create-event", { summary: z.string(), start: z.string().datetime(), end: z.string().datetime() }, async ({ summary, start, end }) => {
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
                content: [{ type: "text", text: event.url }]
            };
        });
        server.tool("list-events", { start: z.string().datetime(), end: z.string().datetime() }, async ({ start, end }) => {
            const calendarObjects = await client.fetchCalendarObjects({
                calendar: calendar,
            });
            const startDate = new Date(start);
            const endDate = new Date(end);
            const filteredEvents = calendarObjects.filter((event) => {
                const eventStart = new Date(event.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, ''));
                const eventEnd = new Date(event.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, ''));
                const summary = event.data.split('SUMMARY:')[1].split('\n')[0];
                return eventStart <= endDate && eventEnd >= startDate;
            });
            return {
                content: [{ type: "text", text: filteredEvents.map((e) => {
                            const summary = e.data.split('SUMMARY:')[1].split('\n')[0];
                            const start = e.data.split('DTSTART:')[1].split('\n')[0].replace(/[-:]/g, '');
                            const end = e.data.split('DTEND:')[1].split('\n')[0].replace(/[-:]/g, '');
                            return `${summary}\nStart: ${start}\nEnd: ${end}`;
                        }).join("\n") }]
            };
        });
        // Connect to the MCP server
        await server.connect(transport);
    }
    else {
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
