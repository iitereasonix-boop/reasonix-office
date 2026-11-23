type CalendarEvent = { id: string; start: Date; title: string; location?: string | null; description?: string | null };

const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const ONE_HOUR = 3_600_000;

export function buildCalendar(events: CalendarEvent[], now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reasonix//Hearings//AR", "CALSCALE:GREGORIAN", "X-WR-CALNAME:جلسات ريزونكس"];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@reasonix`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(event.start)}`,
      `DTEND:${stamp(new Date(event.start.getTime() + ONE_HOUR))}`,
      `SUMMARY:${escape(event.title)}`,
      ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
      ...(event.description ? [`DESCRIPTION:${escape(event.description)}`] : []),
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR"].join("\r\n");
}

export const googleCalendarLink = (title: string, start: Date, location?: string | null) => {
  const dates = `${stamp(start)}/${stamp(new Date(start.getTime() + ONE_HOUR))}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&location=${encodeURIComponent(location ?? "")}`;
};
