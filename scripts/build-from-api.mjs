import fs from "node:fs";
import path from "node:path";

const tokenPath = process.env.DENSITY_API_TOKEN_FILE || "env/density-api-token.txt";
const outputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const apiBase = process.env.DENSITY_API_BASE || "https://api.density.io";
const targetBuildingCodes = new Set(
  (process.env.AMAZON_NONBOOKABLE_BUILDINGS || "SEA25,SEA37,SEA44,SJC31,JFK27,WAS17")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
);

const includedPresenceHealthStatuses = new Set(["healthy", "degraded", "offline"]);

const targetLabels = new Map([
  ["focus", "Focus Rooms"],
  ["focus room", "Focus Rooms"],
  ["huddle", "Huddle Rooms"],
  ["huddle room", "Huddle Rooms"],
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

const requestedRange = {
  start: process.env.AMAZON_NONBOOKABLE_START_DATE || "2026-04-20",
  end: process.env.AMAZON_NONBOOKABLE_END_DATE || "2026-06-17",
  businessHours: "Monday-Friday 09:00-17:00 local"
};
const weeklyWindows = weeklyWindowsForRange(requestedRange.start, requestedRange.end);

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

function labelsFor(space) {
  return (space.labels || []).map((label) => label.name || label.LABEL_NAME || "").filter(Boolean);
}

function targetType(labels, space) {
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (targetLabels.has(normalized)) return targetLabels.get(normalized);
  }
  const descriptiveLabel = labels.find((label) => {
    const normalized = label.trim().toLowerCase();
    return normalized !== "non bookable" && normalized !== "non-bookable" && normalized !== "bookable";
  });
  if (descriptiveLabel) return titleType(descriptiveLabel);

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

function titleType(label) {
  return String(label)
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasNonBookableLabel(labels) {
  return labels.some((label) => {
    const normalized = label.trim().toLowerCase();
    return normalized === "non bookable" || normalized === "non-bookable";
  });
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

function buildingFor(space, byId) {
  if (spaceKind(space) === "building") return space;
  for (const id of [...(space.ancestorIds || [])].reverse()) {
    const candidate = byId.get(id);
    if (candidate && spaceKind(candidate) === "building") return candidate;
  }
  return null;
}

function buildingCode(building) {
  return String(building?.name || building?.id || "")
    .split(" - ")[0]
    .trim()
    .toUpperCase();
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

function weeklyWindowsForRange(start, end) {
  const windows = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day === 0 || day === 6) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const windowStart = cursor.toISOString().slice(0, 10);
    const windowEndDate = new Date(cursor);
    windowEndDate.setDate(cursor.getDate() + (5 - day));
    if (windowEndDate > last) windowEndDate.setTime(last.getTime());
    windows.push({
      start: windowStart,
      end: windowEndDate.toISOString().slice(0, 10)
    });
    cursor.setTime(windowEndDate.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return windows;
}

function buildDashboardData(spaceCatalog, dates, metadata) {
  const buildings = new Map();
  const floors = new Map();

  for (const space of spaceCatalog) {
    buildings.set(space.buildingId, space.buildingName);
    floors.set(space.floorId, {
      floorId: space.floorId,
      floorName: space.floorName,
      buildingId: space.buildingId,
      buildingName: space.buildingName
    });
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
      spaces: spaceCatalog,
      dates
    },
    metrics: {
      intervals: []
    }
  };
}

const token = readToken();
await apiFetch(token, "/v3/hello-world", { headers: { "Content-Type": "text/plain" } });

const allSpaces = await apiFetch(token, "/v3/spaces");
const byId = flattenSpaces(allSpaces);

const candidateSpaces = [...byId.values()]
  .map((space) => {
    const labels = labelsFor(space);
    const type = targetType(labels, space);
    const floor = floorFor(space, byId);
    const building = buildingFor(space, byId);
    return {
      space,
      labels,
      type,
      floor,
      building
    };
  })
  .filter(
    ({ space, labels, type, floor, building }) =>
      building &&
      floor &&
      type &&
      targetBuildingCodes.has(buildingCode(building)) &&
      hasNonBookableLabel(labels) &&
      spaceKind(space) === "space"
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
  throw new Error("No sensor-backed spaces with a Non Bookable / Non-Bookable label were found.");
}

const sourceBuildings = [...new Map(targetSpaces.map(({ building }) => [building.id, building])).values()]
  .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  .map((building) => ({
    code: String(building.name || building.id).split(" - ")[0],
    id: building.id,
    name: building.name || building.id
  }));

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

const dates = businessDates(requestedRange.start, requestedRange.end);
const dashboardData = buildDashboardData(spaceCatalog, dates, {
  source: "Density API /v3/spaces + /v3/analytics/presence-health + /v3/analytics/sessions/raw",
  generatedAt: new Date().toISOString(),
  requestedRange,
  requestedWindows: weeklyWindows,
  includedRange: {
    start: dates[0] || null,
    end: dates[dates.length - 1] || null
  },
  targetBuildings: sourceBuildings,
  rowsRead: 0,
  rowsInScope: 0,
  rowsOutOfBusinessHours: 0,
  rowsMeetingRoom: 0,
  rowsWithoutNonBookableLabel: 0,
  rowsWithoutTargetTypeLabel: 0,
  intervalMinutes: 5,
  apiAudit: {
    spacesReturned: byId.size,
    candidateSpaces: candidateSpaces.length,
    presenceHealthResponses: presenceBySpace.size,
    includedPresenceHealthStatuses: [...includedPresenceHealthStatuses],
    targetSpaces: targetSpaces.length,
    excludedWithoutIncludedPresenceHealth: candidateSpaces.length - targetSpaces.length
  },
  warnings: []
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(dashboardData, null, 2)}\n`);

console.log(
  `Wrote ${outputPath}: ${spaceCatalog.length} non-bookable spaces from Density API. Run build:concurrency to add simultaneous-use rows.`
);
