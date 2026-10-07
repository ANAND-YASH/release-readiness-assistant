const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** Formats a YYYY-MM-DD calendar date (stored as UTC midnight). */
export function formatDate(isoDate: string | null): string {
  return isoDate ? dateFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)) : "—";
}

export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
