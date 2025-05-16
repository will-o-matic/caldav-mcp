import 'dotenv/config'
import { CalDAVClient } from "ts-caldav";


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

  console.log(events);

  // await client.createEvent(calendar.url, {
  //   summary: "Geiles Team Meeting",
  //   start: new Date(),
  //   end: new Date(Date.now() + 3600000), // +1h
  // });
}

main()