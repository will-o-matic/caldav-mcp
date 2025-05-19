# caldav-mcp

A CalDAV Model Context Protocol (MCP) server to expose calendar operations as tools for AI assistants.

## Features

- Connect to CalDAV servers
- Create calendar events
- List calendar events within a specific timeframe

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the project root with your CalDAV credentials:
```
CALDAV_BASE_URL=<CalDAV server URL>
CALDAV_USERNAME=<CalDAV username>
CALDAV_PASSWORD=<CalDAV password>
```

## Setup in Claude Desktop

```
{
  "mcpServers": {
    ...,
    "calendar": {
      "command": "npx",
      "args": [
        "caldav-mcp"
      ],
      "env": {
        "CALDAV_BASE_URL": "<CalDAV server URL>",
        "CALDAV_USERNAME": "<CalDAV username>",
        "CALDAV_PASSWORD": "<CalDAV password>"
      }
    }
  }
}
```

## Usage

1. Compile TypeScript to JavaScript:
```bash
npx tsc
```

2. Run the MCP server:
```bash
node index.js
```

## Available Tools

### create-event

Creates a new calendar event.

Parameters:
- `summary`: String - Event title/summary
- `start`: DateTime string - Event start time
- `end`: DateTime string - Event end time

Returns:
- The unique ID of the created event

### list-events

Lists events within a specified timeframe.

Parameters:
- `start`: DateTime string - Start of the timeframe
- `end`: DateTime string - End of the timeframe

Returns:
- A list of event summaries that fall within the given timeframe

## License

MIT