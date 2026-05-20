import fs from "node:fs";
import path from "node:path";

const sampleDir =
  "/Users/roychan/Downloads/Density Inc._SJC31 - Sunnyvale_undefined_15min_20260504-20260515_8a-6p";

const spacesPath = process.argv[2] || path.join(sampleDir, "spaces.csv");
const labelsPath = process.argv[3] || path.join(sampleDir, "labels.csv");
const outputPath = process.argv[4] || path.join("data", "dashboard-data.json");

const targetBuildings = new Set([
  "spc_1395462610102518015",
  "spc_1092856114543854152",
  "spc_1435649416588427726"
]);

const targetLabels = new Map([
  ["focus", "Focus"],
  ["huddle", "Huddle"],
  ["phone", "Phone"],
  ["phone room", "Phone Room"],
  ["phone booth", "Phone Booth"],
  ["lactation", "Lactation/Mothers Room"],
  ["mothers room", "Lactation/Mothers Room"],
  ["mother's room", "Lactation/Mothers Room"],
  ["inter-faith", "Interfaith Room"],
  ["interfaith", "Interfaith Room"],
  ["quiet room", "Quiet Room"],
  ["quiet", "Quiet Room"],
  ["flex", "Flex"]
]);

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

function readCsvObjects(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  const header = rows.shift();
  return rows.map((row) =>
    Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""]))
  );
}

function labelType(labels, row = {}) {
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "phone" && row.FUNCTION === "phone_booth") {
      return "Phone Booths";
    }
    if (targetLabels.has(normalized)) return targetLabels.get(normalized);
  }
  return null;
}

function mondayOf(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result.toISOString().slice(0, 10);
}

function dateHour(value) {
  const [date, time = "00:00:00"] = value.split("T");
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
  const used = Number(row.TIME_USED_MINUTES) || 0;
  metric.usedMinutes += used;
  metric.availableMinutes += 15;
  metric.avgOccupancyWeightedMinutes +=
    used * (Number(row.AVG_OCCUPANCY_WHEN_USED) || 0);
  metric.entrances += Number(row.ENTRANCES) || 0;
  metric.exits += Number(row.EXITS) || 0;
  metric.observations += 1;
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
    avgOccupancyWhenUsed: metric.usedMinutes
      ? round(metric.avgOccupancyWeightedMinutes / metric.usedMinutes, 2)
      : 0
  };
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const labelsBySpace = new Map();
for (const row of readCsvObjects(labelsPath)) {
  if (!labelsBySpace.has(row.SPACE_ID)) labelsBySpace.set(row.SPACE_ID, []);
  labelsBySpace.get(row.SPACE_ID).push(row.LABEL_NAME);
}

const overall = emptyMetric();
const byType = new Map();
const byFloorTypeWeek = new Map();
const byFloor = new Map();
const bySpace = new Map();
const byDate = new Map();
const byDayHour = new Map();
const buildings = new Map();
const floors = new Map();
const spaceCatalog = new Map();
const intervalRows = [];
const warnings = [];

const metadata = {
  sourceSpacesPath: spacesPath,
  sourceLabelsPath: labelsPath,
  generatedAt: new Date().toISOString(),
  requestedRange: {
    start: "2026-04-20",
    end: "2026-05-15",
    businessHours: "Monday-Friday 09:00-17:00 local"
  },
  includedRange: { start: null, end: null },
  rowsRead: 0,
  rowsInScope: 0,
  rowsOutOfBusinessHours: 0,
  rowsMeetingRoom: 0,
  rowsWithoutNonBookableLabel: 0,
  rowsWithoutTargetTypeLabel: 0,
  intervalMinutes: 15
};

const spaces = readCsvObjects(spacesPath);
metadata.rowsRead = spaces.length;

for (const row of spaces) {
  const labels = labelsBySpace.get(row.SPACE_ID) || [];
  const hasNonBookable = labels.some(
    (label) => label.trim().toLowerCase() === "non bookable"
  );
  const type = labelType(labels, row);
  const { date, hour } = dateHour(row.LOCAL_DATE_TIME);
  const localDate = new Date(`${date}T00:00:00`);
  const day = localDate.getDay();

  if (row.FUNCTION === "meeting_room") {
    metadata.rowsMeetingRoom += 1;
    continue;
  }
  if (!hasNonBookable) {
    metadata.rowsWithoutNonBookableLabel += 1;
    continue;
  }
  if (!type) {
    metadata.rowsWithoutTargetTypeLabel += 1;
    continue;
  }
  if (day === 0 || day === 6 || hour < 9 || hour >= 17) {
    metadata.rowsOutOfBusinessHours += 1;
    continue;
  }

  if (!targetBuildings.has(row.BUILDING_ID)) {
    warnings.push(`Unexpected building id in source: ${row.BUILDING_ID}`);
  }

  metadata.rowsInScope += 1;
  if (!metadata.includedRange.start || date < metadata.includedRange.start) {
    metadata.includedRange.start = date;
  }
  if (!metadata.includedRange.end || date > metadata.includedRange.end) {
    metadata.includedRange.end = date;
  }

  intervalRows.push({
    spaceId: row.SPACE_ID,
    buildingId: row.BUILDING_ID,
    floorId: row.FLOOR_ID,
    type,
    date,
    hour,
    usedMinutes: Number(row.TIME_USED_MINUTES) || 0,
    availableMinutes: 15
  });

  buildings.set(row.BUILDING_ID, row.BUILDING_NAME);
  floors.set(row.FLOOR_ID, {
    floorId: row.FLOOR_ID,
    floorName: row.FLOOR_NAME,
    buildingId: row.BUILDING_ID,
    buildingName: row.BUILDING_NAME
  });
  spaceCatalog.set(row.SPACE_ID, {
    spaceId: row.SPACE_ID,
    spaceName: row.SPACE_NAME,
    floorId: row.FLOOR_ID,
    floorName: row.FLOOR_NAME,
    buildingId: row.BUILDING_ID,
    buildingName: row.BUILDING_NAME,
    function: row.FUNCTION,
    countingMode: row.COUNTING_MODE,
    type,
    labels
  });

  addMetric(new Map([["overall", overall]]), "overall", {}, row);
  addMetric(byType, type, { type }, row);
  addMetric(
    byFloorTypeWeek,
    key([row.BUILDING_ID, row.FLOOR_ID, type, mondayOf(localDate)]),
    {
      buildingId: row.BUILDING_ID,
      buildingName: row.BUILDING_NAME,
      floorId: row.FLOOR_ID,
      floorName: row.FLOOR_NAME,
      type,
      weekStart: mondayOf(localDate)
    },
    row
  );
  addMetric(
    byFloor,
    row.FLOOR_ID,
    {
      buildingId: row.BUILDING_ID,
      buildingName: row.BUILDING_NAME,
      floorId: row.FLOOR_ID,
      floorName: row.FLOOR_NAME
    },
    row
  );
  addMetric(
    bySpace,
    row.SPACE_ID,
    {
      spaceId: row.SPACE_ID,
      spaceName: row.SPACE_NAME,
      floorId: row.FLOOR_ID,
      floorName: row.FLOOR_NAME,
      buildingId: row.BUILDING_ID,
      buildingName: row.BUILDING_NAME,
      function: row.FUNCTION,
      countingMode: row.COUNTING_MODE,
      type
    },
    row
  );
  addMetric(
    byDate,
    key([row.BUILDING_ID, row.FLOOR_ID, type, date]),
    {
      buildingId: row.BUILDING_ID,
      buildingName: row.BUILDING_NAME,
      floorId: row.FLOOR_ID,
      floorName: row.FLOOR_NAME,
      type,
      date,
      dayOfWeek: dayNames[day],
      dayIndex: day
    },
    row
  );
  addMetric(
    byDayHour,
    key([row.BUILDING_ID, row.FLOOR_ID, type, dayNames[day], hour]),
    {
      buildingId: row.BUILDING_ID,
      buildingName: row.BUILDING_NAME,
      floorId: row.FLOOR_ID,
      floorName: row.FLOOR_NAME,
      type,
      dayOfWeek: dayNames[day],
      dayIndex: day,
      hour
    },
    row
  );
}

function values(map) {
  return [...map.values()].map(finalizeMetric);
}

const data = {
  metadata: {
    ...metadata,
    targetBuildings: [...targetBuildings],
    warnings: [...new Set(warnings)]
  },
  dimensions: {
    buildings: [...buildings].map(([buildingId, buildingName]) => ({
      buildingId,
      buildingName
    })),
    floors: [...floors.values()],
    types: [...new Set([...byType.keys()])].sort(),
    spaces: [...spaceCatalog.values()]
  },
  metrics: {
    intervals: intervalRows.map((row) => ({
      ...row,
      usedMinutes: round(row.usedMinutes, 2),
      availableMinutes: round(row.availableMinutes, 2)
    })),
    overall: finalizeMetric(overall),
    byType: values(byType).sort((a, b) => b.usedMinutes - a.usedMinutes),
    byFloor: values(byFloor).sort((a, b) =>
      a.floorName.localeCompare(b.floorName)
    ),
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

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(
  `Wrote ${outputPath}: ${metadata.rowsInScope.toLocaleString()} in-scope rows, ${data.dimensions.spaces.length} spaces.`
);
