import fs from "node:fs";

const dataPath = process.argv[2] || "data/dashboard-data.json";
const csvPath = process.argv[3];

if (!csvPath) {
  throw new Error("Usage: node scripts/check-atlas-csv.mjs data/dashboard-data.json /path/to/spaces.csv");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, "")) || [];
  return rows
    .filter((item) => item.length === headers.length)
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}

function dayIndex(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function addNumber(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const csvRows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const spaces = data.dimensions?.spaces || [];
const spaceById = new Map(spaces.map((space) => [space.spaceId, space]));
const csvDates = [...new Set(csvRows.map((row) => String(row.LOCAL_DATE_TIME || "").slice(0, 10)).filter(Boolean))].sort();
const dateSet = new Set(csvDates);
const buildingNames = [...new Set(csvRows.map((row) => row.BUILDING_NAME).filter(Boolean))].sort();
const matchedSpaces = new Set();
const csvByTimestamp = new Map();
let matchedRows = 0;
let businessRows = 0;
let csvPositiveRows = 0;

for (const row of csvRows) {
  const space = spaceById.get(row.SPACE_ID);
  if (!space) continue;
  matchedRows += 1;
  matchedSpaces.add(space.spaceId);
  const timestamp = row.LOCAL_DATE_TIME || "";
  const date = timestamp.slice(0, 10);
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const day = dayIndex(date);
  if (!dateSet.has(date) || day < 1 || day > 5 || hour < 9 || hour >= 17) continue;
  businessRows += 1;
  const active = Number(row.TIME_USED_MINUTES || 0) / 15;
  if (active > 0) csvPositiveRows += 1;
  for (let offset = 0; offset < 3; offset += 1) {
    addNumber(csvByTimestamp, `${date}|${hour}|${Math.floor(minute / 5) + offset}`, active);
  }
}

const concurrency = data.metrics?.concurrency || {};
const floorIds = concurrency.floors || [];
const types = concurrency.types || [];
const dates = concurrency.dates || data.dimensions?.dates || [];
const relevantFloorIndexes = new Set(
  (data.dimensions?.floors || [])
    .map((floor, index) => (buildingNames.includes(floor.buildingName) ? floorIds.indexOf(floor.floorId) : null))
    .filter((index) => index != null && index >= 0)
);
const relevantTypes = new Set([...matchedSpaces].map((spaceId) => spaceById.get(spaceId)?.type).filter(Boolean));
const relevantTypeIndexes = new Set(types.map((type, index) => (relevantTypes.has(type) ? index : null)).filter((index) => index != null));
const rawByTimestamp = new Map();

for (const row of concurrency.byFloorTypeHour || []) {
  const [floorIndex, typeIndex, dateIndex, hour, slot, active] = row;
  const date = dates[dateIndex];
  if (!dateSet.has(date)) continue;
  if (!relevantFloorIndexes.has(floorIndex)) continue;
  if (!relevantTypeIndexes.has(typeIndex)) continue;
  addNumber(rawByTimestamp, `${date}|${hour}|${slot}`, active);
}

const selectedWindows = csvDates.length * 8 * 12;
const selectedSpaces = matchedSpaces.size;
const csvTotal = [...csvByTimestamp.values()].reduce((total, value) => total + value, 0);
const rawTotal = [...rawByTimestamp.values()].reduce((total, value) => total + value, 0);
const csvPeak = Math.max(0, ...csvByTimestamp.values());
const rawPeak = Math.max(0, ...rawByTimestamp.values());

console.log(
  JSON.stringify(
    {
      csvPath,
      buildingNames,
      csvDates,
      csvRows: csvRows.length,
      matchedRows,
      businessRows,
      csvPositiveRows,
      selectedSpaces,
      selectedWindows,
      csv: {
        avgActive: round(csvTotal / selectedWindows),
        avgSharePct: round((csvTotal / selectedWindows / selectedSpaces) * 100),
        peakActive: round(csvPeak),
        peakSharePct: round((csvPeak / selectedSpaces) * 100)
      },
      rawSessionDashboard: {
        avgActive: round(rawTotal / selectedWindows),
        avgSharePct: round((rawTotal / selectedWindows / selectedSpaces) * 100),
        peakActive: round(rawPeak),
        peakSharePct: round((rawPeak / selectedSpaces) * 100)
      },
      difference: {
        avgSharePct: round((rawTotal / selectedWindows / selectedSpaces - csvTotal / selectedWindows / selectedSpaces) * 100),
        peakSharePct: round((rawPeak / selectedSpaces - csvPeak / selectedSpaces) * 100)
      }
    },
    null,
    2
  )
);
