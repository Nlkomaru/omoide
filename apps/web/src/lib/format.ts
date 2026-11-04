/** A zero focal length, aperture or ISO is a missing EXIF value, not a measurement. */
export function isRecorded(value: number | null | undefined): value is number {
  return value != null && value > 0;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Reads a shifted timestamp back as `YYYY-MM-DD HH:mm:ss`. */
function formatShifted(shiftedMs: number): string {
  return new Date(shiftedMs).toISOString().slice(0, 19).replace("T", " ");
}

/** The camera's clock at capture, the same reading the month filter uses. */
export function formatCaptureTime(takenAt: number, timezoneOffset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezoneOffset);
  if (!match) return formatShifted(takenAt);
  const offsetMs = (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  return formatShifted(takenAt + (match[1] === "-" ? -offsetMs : offsetMs));
}

/** The viewer's clock, to the minute. Call it only on the client: the server's zone can differ. */
export function formatLocalTime(timestamp: number): string {
  const offsetMs = new Date(timestamp).getTimezoneOffset() * 60_000;
  return formatShifted(timestamp - offsetMs).slice(0, 16);
}
