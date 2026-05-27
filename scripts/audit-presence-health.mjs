import fs from "node:fs";
import path from "node:path";

const tokenPath = process.env.DENSITY_API_TOKEN_FILE || "env/density-api-token.txt";
const apiBase = process.env.DENSITY_API_BASE || "https://api.density.io";
const outputDir = process.argv[2] || path.join("data", "presence-health-audit");

const pilotBuildings = [
  { code: "SEA25", id: "spc_1240354454767665670" },
  { code: "SEA37", id: "spc_1372296005617189318" },
  { code: "SEA44", id: "spc_1092856114543854152" },
  { code: "SEA54", id: "spc_1378034448255156721" },
  { code: "SJC31", id: "spc_1435649416588427726" }
];

function readToken() {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing Density API token file: ${tokenPath}`);
  }
  return fs.readFileSync(tokenPath, "utf8").trim();
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
    if (space?.id) byId.set(space.id, { ...space });
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

    byId.set(id, {
      ...space,
      parentId: parentById.get(id) || null,
      ancestorIds
    });
  }

  return byId;
}

function spaceKind(space) {
  return String(space.space_type || space.type || "").toLowerCase();
}

function isDescendantOf(space, buildingIds) {
  return buildingIds.has(space.id) || space.ancestorIds?.some((id) => buildingIds.has(id));
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

function labelsFor(space) {
  return (space.labels || []).map((label) => label.name || label.LABEL_NAME || "").filter(Boolean);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = [
    "building_code",
    "building_name",
    "floor_name",
    "space_id",
    "space_name",
    "function",
    "counting_mode",
    "binary_occupancy",
    "go_live_date_utc",
    "labels",
    "presence_health_status",
    "presence",
    "has_presence_sensor"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function addCount(map, keyParts) {
  const key = keyParts.join("||");
  map.set(key, (map.get(key) || 0) + 1);
}

const token = readToken();
await apiFetch(token, "/v3/hello-world", { headers: { "Content-Type": "text/plain" } });

const allSpaces = await apiFetch(token, "/v3/spaces");
const byId = flattenSpaces(allSpaces);
const buildingIds = new Set(pilotBuildings.map((building) => building.id));
const buildingCodeById = new Map(pilotBuildings.map((building) => [building.id, building.code]));

const spaces = [...byId.values()]
  .filter((space) => isDescendantOf(space, buildingIds))
  .filter((space) => spaceKind(space) === "space")
  .map((space) => {
    const floor = floorFor(space, byId);
    const building = buildingFor(space, byId, buildingIds);
    return { space, floor, building };
  })
  .filter(({ floor, building }) => floor && building);

const presenceBySpace = new Map();
for (const group of chunk(spaces, 100)) {
  const response = await apiFetch(token, "/v3/analytics/presence-health", {
    method: "POST",
    body: JSON.stringify({
      space_ids: group.map(({ space }) => space.id)
    })
  });

  for (const [spaceId, datum] of Object.entries(response?.data || response || {})) {
    presenceBySpace.set(spaceId, datum);
  }
}

const rows = spaces.map(({ space, floor, building }) => {
  const health = presenceBySpace.get(space.id) || null;
  const status = health?.space_health_status || "not_returned";
  const hasPresenceSensor = ["healthy", "degraded", "offline"].includes(status);

  return {
    building_code: buildingCodeById.get(building.id) || "",
    building_name: building.name || building.id,
    floor_name: floor.name || floor.id,
    space_id: space.id,
    space_name: space.name || "",
    function: space.function || "",
    counting_mode: space.counting_mode || "",
    binary_occupancy: space.binary_occupancy ?? "",
    go_live_date_utc: space.go_live_date_utc || "",
    labels: labelsFor(space).join("; "),
    presence_health_status: status,
    presence: health?.presence ?? "",
    has_presence_sensor: hasPresenceSensor
  };
});

rows.sort(
  (a, b) =>
    a.building_code.localeCompare(b.building_code) ||
    a.floor_name.localeCompare(b.floor_name) ||
    a.space_name.localeCompare(b.space_name)
);

const byHealthStatus = new Map();
const byBuilding = new Map();
const byFunction = new Map();
const byLabel = new Map();

for (const row of rows) {
  addCount(byHealthStatus, [row.presence_health_status]);
  addCount(byBuilding, [row.building_code, row.has_presence_sensor]);
  addCount(byFunction, [row.function || "(blank)", row.presence_health_status]);
  for (const label of row.labels.split("; ").filter(Boolean)) {
    addCount(byLabel, [label, row.has_presence_sensor]);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: "Density API /v3/spaces + /v3/analytics/presence-health",
  targetBuildings: pilotBuildings.map((building) => ({
    ...building,
    name: byId.get(building.id)?.name || building.id
  })),
  totals: {
    spaces: rows.length,
    endpointReturned: presenceBySpace.size,
    hasPresenceSensor: rows.filter((row) => row.has_presence_sensor).length,
    noPresenceSensorOrUnknown: rows.filter((row) => !row.has_presence_sensor).length
  },
  byHealthStatus: Object.fromEntries(byHealthStatus),
  byBuilding: Object.fromEntries(byBuilding),
  byFunction: Object.fromEntries(byFunction),
  byLabel: Object.fromEntries(byLabel),
  interpretation: {
    hasPresenceSensor:
      "true when /v3/analytics/presence-health returned healthy, degraded, or offline for the space",
    unknown:
      "Density documents unknown as either unknown sensor state or a space with no sensors; treat as not sensor-confirmed",
    notReturned:
      "The presence-health endpoint did not return a datum for the requested space; treat as not sensor-confirmed"
  }
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "spaces.json"), `${JSON.stringify(rows, null, 2)}\n`);
writeCsv(path.join(outputDir, "spaces.csv"), rows);
writeCsv(
  path.join(outputDir, "spaces-with-presence-sensors.csv"),
  rows.filter((row) => row.has_presence_sensor)
);
writeCsv(
  path.join(outputDir, "spaces-without-confirmed-presence-sensors.csv"),
  rows.filter((row) => !row.has_presence_sensor)
);

console.log(
  `Wrote ${outputDir}: ${summary.totals.hasPresenceSensor}/${summary.totals.spaces} spaces have confirmed presence sensors.`
);
