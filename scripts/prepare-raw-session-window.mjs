import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const outputPath = process.argv[3] || inputPath;

const requestedRange = {
  start: "2026-04-20",
  end: "2026-05-22",
  businessHours: "Monday-Friday 09:00-17:00 local"
};

const requestedWindows = [
  { start: "2026-04-20", end: "2026-04-24" },
  { start: "2026-04-27", end: "2026-05-01" },
  { start: "2026-05-04", end: "2026-05-08" },
  { start: "2026-05-11", end: "2026-05-15" },
  { start: "2026-05-18", end: "2026-05-22" }
];

function businessDates(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const dates = businessDates(requestedRange.start, requestedRange.end);

data.dimensions = {
  ...(data.dimensions || {}),
  dates
};

data.metadata = {
  ...(data.metadata || {}),
  source: "Density API /v3/spaces + /v3/analytics/presence-health + /v3/analytics/sessions/raw",
  requestedRange,
  requestedWindows,
  includedRange: {
    start: dates[0],
    end: dates.at(-1)
  },
  atlasCsvSources: undefined
};

delete data.metadata.atlasCsvSources;
for (const key of [
  "atlasCsvRowsRead",
  "atlasCsvRowsMatchedToNonBookable",
  "atlasCsvRowsWithPositiveUse",
  "atlasCsvImportedConcurrencyRows"
]) {
  if (data.metadata.apiAudit) delete data.metadata.apiAudit[key];
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Prepared raw-session window ${requestedRange.start} to ${requestedRange.end}.`);
