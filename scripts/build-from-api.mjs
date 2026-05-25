import fs from "node:fs";
import path from "node:path";

const tokenPath = process.env.DENSITY_API_TOKEN_FILE || "env/density-api-token.txt";
const outputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const apiBase = process.env.DENSITY_API_BASE || "https://api.density.io";

const pilotBuildings = [
  { code: "SEA25", id: "spc_1240354454767665670" },
  { code: "SEA37", id: "spc_1372296005617189318" },
  { code: "SEA44", id: "spc_1092856114543854152" },
  { code: "SJC31", id: "spc_1435649416588427726" }
];

const includedPresenceHealthStatuses = new Set(["healthy", "degraded", "offline"]);

const targetLabels = new Map([
  ["focus", "Focus Rooms"],
  ["huddle", "Huddle Rooms"],
  ["phone", "Phone Booths"],
  ["phone room", "Phone Rooms"],
  ["phone booth", "Phone Booths"],
  ["lactation", "Mother's Rooms"],
  ["mothers room", "Mother's Rooms"],
  ["mother's room", "Mother's Rooms"],
  ["inter-faith", "Interfaith Rooms"],
  ["interfaith", "Interfaith Rooms"],
  ["quiet room", "Quiet Rooms"],
  ["quiet", "Quiet Rooms"],
  ["flex", "Flex Spaces"],
  ["bookable conference", "Meeting Rooms"],
  ["non bookable conference", "Meeting Rooms"],
  ["meet", "Meeting Rooms"],
  ["workpoints", "Desks"],
  ["work", "Desks"]
]);

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const requestedRange = {
  start: "2026-04-20",
  end: "2026-05-15",
  businessHours: "Monday-Friday 09:00-17:00 local"
};
const weeklyWindows = [
  { start: "2026-04-20", end: "2026-04-24" },
  { start: "2026-04-27", end: "2026-05-01" },
  { start: "2026-05-04", end: "2026-05-08" },
  { start: "2026-05-11", end: "2026-05-15" }
];

function readToken() {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Missing Density API token file: ${tokenPath}. Put only the token value in that file.`
    );
  }
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
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function flattenSpaces(spaces) {
  const byId = new Map();
  const parentById = new Map();

  for (const space of spaces) {
    if (!space?.id) continue;
    byId.set(space.id, { ...space });
  }

  for (const space of spaces) {
    for (const childId of space.children_ids || []) {
      parentById.set(childId, space.id);
    }
    for (const child of space.children || []) {
      if (child?.id) parentById.set(child.id, space.id);
    }
  }

  for (const [id, space] of byId) {
    const ancestorIds = [];
    let parentId = parentById.get(id);
    const seen = new Set([id]);
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      ancestorIds.unshift(parentId);
      parentId = parentById.get(parentId);
    }
    byId.set(id, { ...space, parentId: parentById.get(id) || null, ancestorIds });
  }

  return byId;
}

function isDescendantOf(space, buildingIds) {
  return buildingIds.has(space.id) || space.ancestorIds?.some((id) => buildingIds.has(id));
}

function labelsFor(space) {
  return (space.labels || []).map((label) => label.name || label.LABEL_NAME || "").filter(Boolean);
}

function targetType(labels, space) {
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (targetLabels.has(normalized)) return targetLabels.get(normalized);
  }
  const functionName = String(space.function || "").replaceAll("_", " ").toLowerCase();
  if (targetLabels.has(functionName)) return targetLabels.get(functionName);
  if (functionName === "phone booth") return "Phone Booths";
  if (functionName === "meeting room") return "Meeting Rooms";
  if (functionName === "flex space") return "Flex Spaces";
  if (functionName === "desk") return "Desks";

  const name = String(space.name || "").toLowerCase();
  if (name.includes("focus")) return "Focus Rooms";
  if (name.includes("huddle")) return "Huddle Rooms";
  if (name.includes("phone")) return "Phone Rooms";
  if (name.includes("interfaith") || name.includes("inter-faith")) return "Interfaith Rooms";
  return space.function
    ? space.function.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Uncategorized";
}

function spaceKind(space) {
  return String(space.space_type || space.type || "").toLowerCase();
}

function floorFor(space, byId) {
  if (spaceKind(space) === "floor") return space;
  for (const id of [...(space.ancestorIds || [])].reverse()) {
    const candidate = byId.get(id);
    if (candidate && spaceKind(candidate) === "floor") return candidate;
  }
  return null;
}

function buildingFor(space, byId, buildingIds) {
  if (buildingIds.has(space.id)) return space;
  for (const id of [...(space.ancestorIds || [])].reverse()) {
    if (buildingIds.has(id)) return byId.get(id);
  }
  return null;
}

function metricBuckets(datum) {
  if (!datum) return [];
  if (Array.isArray(datum)) return datum;
  for (const key of ["data", "results", "values", "buckets", "metrics", "time_used"]) {
    if (Array.isArray(datum[key])) return datum[key];
  }
  const timestampEntries = Object.entries(datum).filter(
    ([entryKey, value]) =>
      /^\d{4}-\d{2}-\d{2}T/.test(entryKey) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
  );
  if (timestampEntries.length) {
    return timestampEntries.map(([timestamp, value]) => ({ ...value, timestamp }));
  }
  return [datum];
}

function bucketTimestamp(bucket) {
  return (
    bucket.start_date ||
    bucket.start_time ||
    bucket.timestamp ||
    bucket.local_date_time ||
    bucket.date_time ||
    bucket.datetime ||
    bucket.date ||
    null
  );
}

function bucketUsedMinutes(bucket) {
  const rawMs =
    bucket.time_used_raw ??
    bucket.time_used_ms ??
    bucket.timeUsedRaw ??
    bucket.raw;
  if (rawMs != null) return Number(rawMs) / 60000;

  const seconds = bucket.time_used_seconds ?? bucket.timeUsedSeconds;
  if (seconds != null) return Number(seconds) / 60;

  const minutes = bucket.time_used_minutes ?? bucket.timeUsedMinutes;
  if (minutes != null) return Number(minutes);

  const pct = bucket.time_used_percentage ?? bucket.timeUsedPercentage;
  if (pct != null) return Number(pct) * 60;

  return 0;
}

function bucketAvailableMinutes(bucket) {
  const durationMs = bucket.duration_ms ?? bucket.bucket_duration_ms;
  if (durationMs != null) return Number(durationMs) / 60000;
  const durationMinutes = bucket.duration_minutes ?? bucket.bucket_duration_minutes;
  if (durationMinutes != null) return Number(durationMinutes);
  return 60;
}

function mondayOf(date) {
  const result = new Date(`${date}T00:00:00`);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result.toISOString().slice(0, 10);
}

function localDateParts(timestamp) {
  const dateTime = String(timestamp).replace("Z", "");
  const [date, time = "00:00:00"] = dateTime.split("T");
  return { date, hour: Number(time.slice(0, 2)) };
}

function key(parts) {
  return parts.join("||");
}

function emptyMetric(extra = {}) {
  return {
    usedMinutes: 0,
    availableMinutes: 0,
    avgOccupancyWeightedMinutes: 0,
    entrances: 0,
    exits: 0,
    observations: 0,
    ...extra
  };
}

function addMetric(map, id, extra, row) {
  if (!map.has(id)) map.set(id, emptyMetric(extra));
  const metric = map.get(id);
  metric.usedMinutes += row.usedMinutes;
  metric.availableMinutes += row.availableMinutes;
  metric.observations += 1;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function finalizeMetric(metric) {
  const usedHours = metric.usedMinutes / 60;
  const availableHours = metric.availableMinutes / 60;
  return {
    ...metric,
    usedMinutes: round(metric.usedMinutes, 1),
    availableMinutes: round(metric.availableMinutes, 1),
    usedHours: round(usedHours, 2),
    availableHours: round(availableHours, 2),
    utilization: metric.availableMinutes
      ? round((metric.usedMinutes / metric.availableMinutes) * 100, 1)
      : 0,
    avgOccupancyWhenUsed: 0
  };
}

function values(map) {
  return [...map.values()].map(finalizeMetric);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchPresenceHealth(token, spaces) {
  const presenceBySpace = new Map();
  for (const group of chunk(spaces, 100)) {
    const result = await apiFetch(token, "/v3/analytics/presence-health", {
      method: "POST",
      body: JSON.stringify({
        space_ids: group.map(({ space }) => space.id)
      })
    });
    for (const [spaceId, datum] of Object.entries(result?.data || result || {})) {
      presenceBySpace.set(spaceId, datum);
    }
  }
  return presenceBySpace;
}

function buildDashboardData(spaceCatalog, metricRows, metadata) {
  const overall = emptyMetric();
  const byType = new Map();
  const byFloorTypeWeek = new Map();
  const byFloor = new Map();
  const bySpace = new Map();
  const byDate = new Map();
  const byDayHour = new Map();
  const buildings = new Map();
  const floors = new Map();

  for (const row of metricRows) {
    const dateObject = new Date(`${row.date}T00:00:00`);
    const day = dateObject.getDay();
    const weekStart = mondayOf(row.date);

    buildings.set(row.buildingId, row.buildingName);
    floors.set(row.floorId, {
      floorId: row.floorId,
      floorName: row.floorName,
      buildingId: row.buildingId,
      buildingName: row.buildingName
    });

    addMetric(new Map([["overall", overall]]), "overall", {}, row);
    addMetric(byType, row.type, { type: row.type }, row);
    addMetric(
      byFloorTypeWeek,
      key([row.buildingId, row.floorId, row.type, weekStart]),
      {
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        floorId: row.floorId,
        floorName: row.floorName,
        type: row.type,
        weekStart
      },
      row
    );
    addMetric(
      byFloor,
      row.floorId,
      {
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        floorId: row.floorId,
        floorName: row.floorName
      },
      row
    );
    addMetric(
      bySpace,
      row.spaceId,
      {
        spaceId: row.spaceId,
        spaceName: row.spaceName,
        floorId: row.floorId,
        floorName: row.floorName,
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        function: row.function,
        countingMode: row.countingMode,
        type: row.type
      },
      row
    );
    addMetric(
      byDate,
      key([row.buildingId, row.floorId, row.type, row.date]),
      {
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        floorId: row.floorId,
        floorName: row.floorName,
        type: row.type,
        date: row.date,
        dayOfWeek: dayNames[day],
        dayIndex: day
      },
      row
    );
    addMetric(
      byDayHour,
      key([row.buildingId, row.floorId, row.type, dayNames[day], row.hour]),
      {
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        floorId: row.floorId,
        floorName: row.floorName,
        type: row.type,
        dayOfWeek: dayNames[day],
        dayIndex: day,
        hour: row.hour
      },
      row
    );
  }

  return {
    metadata,
    dimensions: {
      buildings: [...buildings].map(([buildingId, buildingName]) => ({
        buildingId,
        buildingName
      })),
      floors: [...floors.values()],
      types: [...new Set(spaceCatalog.map((space) => space.type))].sort(),
      spaces: spaceCatalog
    },
    metrics: {
      intervals: metricRows.map((row) => ({
        spaceId: row.spaceId,
        buildingId: row.buildingId,
        floorId: row.floorId,
        type: row.type,
        date: row.date,
        hour: row.hour,
        usedMinutes: round(row.usedMinutes, 2),
        availableMinutes: round(row.availableMinutes, 2)
      })),
      overall: finalizeMetric(overall),
      byType: values(byType).sort((a, b) => b.usedMinutes - a.usedMinutes),
      byFloor: values(byFloor).sort((a, b) => a.floorName.localeCompare(b.floorName)),
      byFloorTypeWeek: values(byFloorTypeWeek).sort(
        (a, b) =>
          a.weekStart.localeCompare(b.weekStart) ||
          a.floorName.localeCompare(b.floorName) ||
          a.type.localeCompare(b.type)
      ),
      bySpace: values(bySpace).sort((a, b) => b.usedMinutes - a.usedMinutes),
      byDate: values(byDate).sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.floorName.localeCompare(b.floorName) ||
          a.type.localeCompare(b.type)
      ),
      byDayHour: values(byDayHour).sort(
        (a, b) => a.dayIndex - b.dayIndex || a.hour - b.hour
      )
    }
  };
}

const token = readToken();
await apiFetch(token, "/v3/hello-world", { headers: { "Content-Type": "text/plain" } });

const allSpaces = await apiFetch(token, "/v3/spaces");
const byId = flattenSpaces(allSpaces);
const buildingIds = new Set(pilotBuildings.map((building) => building.id));
const sourceBuildings = pilotBuildings.map((building) => ({
  ...building,
  name: byId.get(building.id)?.name || building.id
}));

const candidateSpaces = [...byId.values()]
  .filter((space) => isDescendantOf(space, buildingIds))
  .map((space) => {
    const labels = labelsFor(space);
    const type = targetType(labels, space);
    const floor = floorFor(space, byId);
    const building = buildingFor(space, byId, buildingIds);
    return {
      space,
      labels,
      type,
      floor,
      building
    };
  })
  .filter(
    ({ space, type, floor, building }) =>
      building && floor && type && spaceKind(space) === "space"
  );

const presenceBySpace = await fetchPresenceHealth(token, candidateSpaces);
const targetSpaces = candidateSpaces
  .map((candidate) => ({
    ...candidate,
    presenceHealth: presenceBySpace.get(candidate.space.id) || null
  }))
  .filter(({ presenceHealth }) =>
    includedPresenceHealthStatuses.has(presenceHealth?.space_health_status)
  );

if (!targetSpaces.length) {
  throw new Error("No sensor-backed target spaces found under the pilot building IDs.");
}

const metricsBySpace = new Map();
for (const window of weeklyWindows) {
  for (const ids of chunk(targetSpaces.map(({ space }) => space.id), 100)) {
    const result = await apiFetch(token, "/v3/analytics/time-used", {
      method: "POST",
      body: JSON.stringify({
        start_date: `${window.start}T00:00:00`,
        end_date: `${window.end}T23:59:59`,
        operating_hours: {
          days: [1, 2, 3, 4, 5],
          start_hour: 9,
          end_hour: 17
        },
        space_ids: ids,
        time_resolution: "hour"
      })
    });
    for (const [spaceId, datum] of Object.entries(result || {})) {
      if (!metricsBySpace.has(spaceId)) metricsBySpace.set(spaceId, []);
      metricsBySpace.get(spaceId).push(...metricBuckets(datum));
    }
  }
}

const spaceCatalog = targetSpaces.map(({ space, labels, type, floor, building }) => ({
  spaceId: space.id,
  spaceName: space.name,
  floorId: floor.id,
  floorName: floor.name,
  buildingId: building.id,
  buildingName: building.name,
  function: space.function || "",
  countingMode: space.counting_mode || "",
  presenceHealthStatus:
    presenceBySpace.get(space.id)?.space_health_status || "",
  type,
  labels
}));

const catalogById = new Map(spaceCatalog.map((space) => [space.spaceId, space]));
const metricRows = [];
let bucketsWithoutTimestamp = 0;

for (const [spaceId, buckets] of metricsBySpace) {
  const catalog = catalogById.get(spaceId);
  if (!catalog) continue;
  for (const bucket of buckets) {
    const timestamp = bucketTimestamp(bucket);
    if (!timestamp) {
      bucketsWithoutTimestamp += 1;
      continue;
    }
    const { date, hour } = localDateParts(timestamp);
    metricRows.push({
      ...catalog,
      date,
      hour,
      usedMinutes: bucketUsedMinutes(bucket),
      availableMinutes: bucketAvailableMinutes(bucket)
    });
  }
}

const includedDates = metricRows.map((row) => row.date).sort();
const dashboardData = buildDashboardData(spaceCatalog, metricRows, {
  source: "Density API /v3/spaces + /v3/analytics/presence-health + /v3/analytics/time-used",
  generatedAt: new Date().toISOString(),
  requestedRange,
  requestedWindows: weeklyWindows,
  includedRange: {
    start: includedDates[0] || null,
    end: includedDates[includedDates.length - 1] || null
  },
  targetBuildings: sourceBuildings,
  rowsRead: metricRows.length,
  rowsInScope: metricRows.length,
  rowsOutOfBusinessHours: 0,
  rowsMeetingRoom: 0,
  rowsWithoutNonBookableLabel: 0,
  rowsWithoutTargetTypeLabel: 0,
  intervalMinutes: 60,
  apiAudit: {
    spacesReturned: byId.size,
    candidateSpaces: candidateSpaces.length,
    presenceHealthResponses: presenceBySpace.size,
    includedPresenceHealthStatuses: [...includedPresenceHealthStatuses],
    targetSpaces: targetSpaces.length,
    excludedWithoutIncludedPresenceHealth: candidateSpaces.length - targetSpaces.length,
    metricSpaceResponses: metricsBySpace.size,
    bucketsWithoutTimestamp
  },
  warnings:
    bucketsWithoutTimestamp > 0
      ? [`Skipped ${bucketsWithoutTimestamp} time-used buckets without timestamps.`]
      : []
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(dashboardData, null, 2)}\n`);

console.log(
  `Wrote ${outputPath}: ${metricRows.length.toLocaleString()} metric rows, ${spaceCatalog.length} spaces from Density API.`
);
