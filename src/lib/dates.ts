// The server may run in UTC, but every office day is a day in Amman.
const AMMAN = "Asia/Amman";

export const ammanDayKey = (value: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: AMMAN }).format(value);

/** Midnight in Amman for the given instant, read from the zone database so DST rules stay correct. */
export function ammanDayStart(value: Date = new Date()) {
  const key = ammanDayKey(value);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: AMMAN, timeZoneName: "longOffset" })
    .formatToParts(value).find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "+03:00";
  return new Date(`${key}T00:00:00${offset}`);
}

export const ammanHour = (value: Date = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: AMMAN, hour: "2-digit", hourCycle: "h23" }).format(value));

export const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);

export const displayDate = (value: Date) => ammanDayKey(value).replaceAll("-", "/");
export const displayDateTime = (value: Date) =>
  `${displayDate(value)} ${new Intl.DateTimeFormat("en-GB", { timeZone: AMMAN, hour: "2-digit", minute: "2-digit" }).format(value)}`;

/** True when the hour falls inside the office's sending window. */
export const insideQuietWindow = (hour: number, start: number, end: number) => hour >= start && hour < end;

/** First moment the window opens at or after the given instant. */
export function nextSendTime(from: Date, start: number, end: number) {
  if (insideQuietWindow(ammanHour(from), start, end)) return from;
  const dayStart = ammanDayStart(from);
  const today = new Date(dayStart.getTime() + start * 3_600_000);
  return from < today ? today : addDays(today, 1);
}
