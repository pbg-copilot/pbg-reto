export type LocalDateTimeResolution = {
  timeZone: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  startLocal: string;
  endLocal: string;
  startUtcOffsetMinutes: number;
};

export class LocalDateTimeError extends Error {
  constructor(
    readonly code:
      | "invalid_time_zone"
      | "invalid_local_datetime"
      | "nonexistent_local_time"
      | "ambiguous_local_time"
      | "invalid_utc_offset",
    readonly choices: { startAt: string; utcOffsetMinutes: number }[] = [],
  ) {
    super(code);
    this.name = "LocalDateTimeError";
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function asUtcEpoch(parts: LocalParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  try {
    if (timeZone !== "UTC" && !timeZone.includes("/"))
      throw new RangeError("An IANA region/city timezone is required");
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new LocalDateTimeError("invalid_time_zone");
  }
}

function partsAt(epochMs: number, formatter: Intl.DateTimeFormat): LocalParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function sameLocalTime(a: LocalParts, b: LocalParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function parseLocalDateTime(value: string): LocalParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match) throw new LocalDateTimeError("invalid_local_datetime");
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (
    parts.year < 1000 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    throw new LocalDateTimeError("invalid_local_datetime");
  const date = new Date(asUtcEpoch(parts));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day
  )
    throw new LocalDateTimeError("invalid_local_datetime");
  return parts;
}

function offsetAt(epochMs: number, formatter: Intl.DateTimeFormat): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  return asUtcEpoch(partsAt(wholeSecond, formatter)) - wholeSecond;
}

function localIsoWithOffset(
  epochMs: number,
  formatter: Intl.DateTimeFormat,
): string {
  const parts = partsAt(epochMs, formatter);
  const offsetMinutes =
    (asUtcEpoch(parts) - Math.floor(epochMs / 1000) * 1000) / 60_000;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const date = [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
  const time = [
    String(parts.hour).padStart(2, "0"),
    String(parts.minute).padStart(2, "0"),
    String(parts.second).padStart(2, "0"),
  ].join(":");
  return `${date}T${time}${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
}

export function resolveLocalDateTime(
  localStart: string,
  timeZone: string,
  durationMinutes: number,
  requestedUtcOffsetMinutes?: number,
): LocalDateTimeResolution {
  const formatter = formatterFor(timeZone);
  const localParts = parseLocalDateTime(localStart);
  const localEpoch = asUtcEpoch(localParts);
  const offsets = new Set<number>();
  const sampleRangeMs = 36 * 60 * 60 * 1000;
  const sampleStepMs = 6 * 60 * 60 * 1000;
  for (let delta = -sampleRangeMs; delta <= sampleRangeMs; delta += sampleStepMs)
    offsets.add(offsetAt(localEpoch + delta, formatter));

  const candidates = [...offsets]
    .map((offset) => localEpoch - offset)
    .filter((candidate) => sameLocalTime(partsAt(candidate, formatter), localParts))
    .sort((a, b) => a - b);
  if (candidates.length === 0)
    throw new LocalDateTimeError("nonexistent_local_time");
  const choices = candidates.map((candidate) => ({
    epoch: candidate,
    offsetMinutes: offsetAt(candidate, formatter) / 60_000,
  }));
  if (choices.length > 1 && requestedUtcOffsetMinutes === undefined)
    throw new LocalDateTimeError(
      "ambiguous_local_time",
      choices.map((choice) => ({
        startAt: new Date(choice.epoch).toISOString(),
        utcOffsetMinutes: choice.offsetMinutes,
      })),
    );

  const selected =
    requestedUtcOffsetMinutes === undefined
      ? choices[0]
      : choices.find(
          (choice) => choice.offsetMinutes === requestedUtcOffsetMinutes,
        );
  if (!selected) throw new LocalDateTimeError("invalid_utc_offset");
  const startEpoch = selected.epoch;
  const endEpoch = startEpoch + durationMinutes * 60_000;
  const normalizedTimeZone = formatter.resolvedOptions().timeZone;
  return {
    timeZone: normalizedTimeZone,
    startAt: new Date(startEpoch),
    endAt: new Date(endEpoch),
    durationMinutes,
    startLocal: localIsoWithOffset(startEpoch, formatter),
    endLocal: localIsoWithOffset(endEpoch, formatter),
    startUtcOffsetMinutes: selected.offsetMinutes,
  };
}
