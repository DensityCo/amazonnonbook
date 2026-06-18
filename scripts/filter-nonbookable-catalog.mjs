import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const outputPath = process.argv[3] || inputPath;

function isNonBookableSpace(space) {
  const labels = (space.labels || []).map((label) => String(label).trim().toLowerCase());
  return labels.some((label) => label === "non bookable" || label === "non-bookable");
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const spaces = (data.dimensions?.spaces || []).filter(isNonBookableSpace);
const buildingIds = new Set(spaces.map((space) => space.buildingId));
const floorIds = new Set(spaces.map((space) => space.floorId));
const types = [...new Set(spaces.map((space) => space.type))].sort();
const dates = data.dimensions?.dates || data.metrics?.concurrency?.dates || [];

data.dimensions = {
  ...(data.dimensions || {}),
  buildings: (data.dimensions?.buildings || []).filter((building) => buildingIds.has(building.buildingId)),
  floors: (data.dimensions?.floors || []).filter((floor) => floorIds.has(floor.floorId)),
  types,
  spaces,
  dates
};
data.metrics = {
  intervals: [],
  concurrency: {
    source: "Density API /v3/analytics/sessions/raw",
    method:
      "A space is active in a five-minute slice when a raw session overlaps that slice; hourly chart points average the 12 slices in each hour.",
    generatedAt: null,
    grainMinutes: 5,
    businessHours: {
      days: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 17
    },
    dates,
    floors: data.dimensions.floors.map((floor) => floor.floorId),
    types,
    sessionsRead: 0,
    sessionsWithPositiveDuration: 0,
    byTypeHour: [],
    byFloorTypeHour: []
  }
};
data.metadata = {
  ...(data.metadata || {}),
  source: "Filtered labeled non-bookable catalog + Density API /v3/analytics/sessions/raw + Atlas CSV source-of-truth imports",
  rowsRead: 0,
  rowsInScope: 0,
  apiAudit: {
    ...((data.metadata || {}).apiAudit || {}),
    targetSpaces: spaces.length,
    filteredToLabeledNonBookableOnly: true
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Filtered catalog to ${spaces.length.toLocaleString()} labeled non-bookable spaces.`);
