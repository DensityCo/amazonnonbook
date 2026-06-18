import fs from "node:fs";
import path from "node:path";

const tokenPath = process.env.DENSITY_API_TOKEN_FILE || "env/density-api-token.txt";
const inputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const outputPath = process.argv[3] || inputPath;
const apiBase = process.env.DENSITY_API_BASE || "https://api.density.io";
const grainMinutes = 5;
const businessDays = new Set([1, 2, 3, 4, 5]);
const businessStartHour = 9;
const businessEndHour = 17;

function readToken() {
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!token) throw new Error(`Density API token file is empty: ${tokenPath}`);
  return token;
}

async function apiFetch(token, route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${route} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sessionItems(result) {
  const items = [];
  for (const [spaceId, datum] of Object.entries(result || {})) {
    const sessions = Array.isArray(datum?.sessions) ? datum.sessions : [];
    for (const session of sessions) items.push({ spaceId, session });
  }
  return items;
}

function timestampOffset(timestamp) {
  return String(timestamp || "").match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] || "+00:00";
}

function localDate(timestamp) {
  return String(timestamp || "").slice(0, 10);
}

function dayIndex(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function addToSetMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function setRows(map, parseKey) {
  return [...map]
    .map(([key, ids]) => [...parseKey(key), ids.size])
    .filter((row) => row.at(-1) > 0);
}

function datesFor(data) {
  if (Array.isArray(data.dimensions?.dates) && data.dimensions.dates.length) {
    return data.dimensions.dates;
  }
  return [...new Set((data.metrics?.intervals || []).map((row) => row.date).filter(Boolean))].sort();
}

function buildConcurrency(data, sessionRows) {
  const dates = datesFor(data);
  const dateIndexes = new Map(dates.map((date, index) => [date, index]));
  const floors = data.dimensions.floors || [];
  const floorIndexes = new Map(floors.map((floor, index) => [floor.floorId, index]));
  const types = data.dimensions.types || [];
  const typeIndexes = new Map(types.map((type, index) => [type, index]));
  const spaces = data.dimensions.spaces || [];
  const spaceById = new Map(spaces.map((space) => [space.spaceId, space]));
  const spaceIndexes = new Map(spaces.map((space, index) => [space.spaceId, index]));
  const byFloorTypeHour = new Map();
  const byTypeHour = new Map();
  const bySpaceDaySlots = new Map();
  const bySpaceHourSlots = new Map();
  let sessionsRead = 0;
  let sessionsSkippedInactiveType = 0;
  let sessionsWithPositiveDuration = 0;

  for (const { spaceId, session } of sessionRows) {
    sessionsRead += 1;
    if (String(session.session_type ?? "1") !== "1") {
      sessionsSkippedInactiveType += 1;
      continue;
    }
    const space = spaceById.get(spaceId);
    if (!space || !session.start_time || !session.end_time) continue;
    const startMs = Date.parse(session.start_time);
    const endMs = Date.parse(session.end_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    sessionsWithPositiveDuration += 1;

    const floorIndex = floorIndexes.get(space.floorId);
    const typeIndex = typeIndexes.get(space.type);
    const spaceIndex = spaceIndexes.get(space.spaceId);
    if (floorIndex == null || typeIndex == null || spaceIndex == null) continue;

    const offset = timestampOffset(session.start_time);
    const sessionStartDate = localDate(session.start_time);
    const sessionEndDate = localDate(session.end_time);
    const candidateDates = dates.filter((date) => date >= sessionStartDate && date <= sessionEndDate);

    for (const date of candidateDates) {
      const dateIndex = dateIndexes.get(date);
      const day = dayIndex(date);
      if (!businessDays.has(day)) continue;
      for (let hour = businessStartHour; hour < businessEndHour; hour += 1) {
        for (let slot = 0; slot < 60 / grainMinutes; slot += 1) {
          const minute = slot * grainMinutes;
          const bucketStart = Date.parse(
            `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`
          );
          const bucketEnd = bucketStart + grainMinutes * 60 * 1000;
          if (startMs < bucketEnd && endMs > bucketStart) {
            addToSetMap(byTypeHour, `${typeIndex}|${dateIndex}|${hour}|${slot}`, spaceId);
            addToSetMap(byFloorTypeHour, `${floorIndex}|${typeIndex}|${dateIndex}|${hour}|${slot}`, spaceId);
            addToSetMap(bySpaceDaySlots, `${spaceIndex}|${dateIndex}`, `${hour}|${slot}`);
            addToSetMap(bySpaceHourSlots, `${spaceIndex}|${dateIndex}|${hour}`, slot);
          }
        }
      }
    }
  }

  return {
    source: "Density API /v3/analytics/sessions/raw",
    method:
      "A space is active in a five-minute slice when a raw session overlaps that slice; hourly chart points average the 12 slices in each hour.",
    generatedAt: new Date().toISOString(),
    grainMinutes,
    businessHours: {
      days: [1, 2, 3, 4, 5],
      startHour: businessStartHour,
      endHour: businessEndHour
    },
    dates,
    floors: floors.map((floor) => floor.floorId),
    types,
    sessionsRead,
    sessionsSkippedInactiveType,
    sessionsWithPositiveDuration,
    byTypeHour: setRows(byTypeHour, (key) => key.split("|").map(Number)),
    byFloorTypeHour: setRows(byFloorTypeHour, (key) => key.split("|").map(Number)),
    bySpaceDay: [...bySpaceDaySlots]
      .map(([key, slots]) => [...key.split("|").map(Number), slots.size * grainMinutes])
      .filter((row) => row[2] > 0),
    bySpaceHour: [...bySpaceHourSlots]
      .map(([key, slots]) => [...key.split("|").map(Number), slots.size * grainMinutes])
      .filter((row) => row[3] > 0)
  };
}

const token = readToken();
const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const targetIds = (data.dimensions.spaces || []).map((space) => space.spaceId);
const windows = data.metadata.requestedWindows || [data.metadata.includedRange];
const sessionRows = [];

for (const window of windows) {
  const groups = chunk(targetIds, 100);
  for (const [index, ids] of groups.entries()) {
    console.error(
      `Raw sessions ${window.start} to ${window.end}, batch ${index + 1}/${groups.length} (${ids.length} spaces)`
    );
    const result = await apiFetch(token, "/v3/analytics/sessions/raw", {
      method: "POST",
      body: JSON.stringify({
        start_date: `${window.start}T${String(businessStartHour).padStart(2, "0")}:00:00`,
        end_date: `${window.end}T${String(businessEndHour).padStart(2, "0")}:00:00`,
        space_ids: ids
      })
    });
    sessionRows.push(...sessionItems(result));
  }
}

const concurrency = buildConcurrency(data, sessionRows);
data.dimensions = {
  ...data.dimensions,
  dates: concurrency.dates
};
data.metrics = {
  ...data.metrics,
  concurrency
};
data.metadata = {
  ...data.metadata,
  apiAudit: {
    ...(data.metadata.apiAudit || {}),
    rawSessionResponses: sessionRows.length,
    concurrencyGrainMinutes: grainMinutes
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(
  `Wrote ${outputPath}: ${concurrency.sessionsRead.toLocaleString()} raw sessions, ${concurrency.grainMinutes}-minute concurrency buckets across ${concurrency.types.length} space types.`
);
