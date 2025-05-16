"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ts_caldav_1 = require("ts-caldav");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
// Create an MCP server
const server = new mcp_js_1.McpServer({
    name: "Demo",
    version: "1.0.0"
});
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield ts_caldav_1.CalDAVClient.create({
            baseUrl: process.env.CALDAV_BASE_URL || "",
            auth: {
                type: "basic",
                username: process.env.CALDAV_USERNAME || "",
                password: process.env.CALDAV_PASSWORD || ""
            }
        });
        // List calendars
        const calendars = yield client.getCalendars();
        const calendar = calendars[0];
        // Fetch events
        // console.log(events);
        //
        // Async tool with external API call
        server.tool("create-event", { summary: zod_1.z.string(), start: zod_1.z.string().datetime(), end: zod_1.z.string().datetime() }, (_a) => __awaiter(this, [_a], void 0, function* ({ summary, start, end }) {
            console.log("Creating event: ", summary, start, end);
            const event = yield client.createEvent(calendar.url, {
                summary: summary,
                start: new Date(start),
                end: new Date(end),
            });
            return {
                content: [{ type: "text", text: event.uid }]
            };
        }));
        server.tool("list-events", { start: zod_1.z.string().datetime(), end: zod_1.z.string().datetime() }, (_a) => __awaiter(this, [_a], void 0, function* ({ start, end }) {
            console.log("Listing events: ", start, end);
            const allEvents = yield client.getEvents(calendar.url);
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
                content: [{ type: "text", text: filteredEvents.map(e => e.summary).join("\n") }]
            };
        }));
        // Start receiving messages on stdin and sending messages on stdout
        const transport = new stdio_js_1.StdioServerTransport();
        yield server.connect(transport);
        console.log("MCPServer started");
    });
}
main();
