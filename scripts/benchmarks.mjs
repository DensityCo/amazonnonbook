import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const benchmarkTypeMap = new Map([
  ["Phone Booth", "phone_booth"],
  ["Phone Room", "phone_booth"],
  ["Focus", "enclosed_workspace"],
  ["Quiet Room", "wellness_room"],
  ["Lactation/Mothers Room", "wellness_room"],
  ["Interfaith Room", "wellness_room"],
  ["Huddle", "open_collaboration_space"],
  ["Flex", "open_collaboration_space"]
]);

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function groupBy(rows, getKey) {
  const map = new Map();
  for (const row of rows) {
    const key = getKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stddev(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const avg = finite.reduce((total, value) => total + value, 0) / finite.length;
  const variance =
    finite.reduce((total, value) => total + (value - avg) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function buildTimeUsedValues(rows, spaces) {
  const dates = unique(rows.map((row) => row.date));
  const totalUsedHours = sum(rows, "usedMinutes") / 60;
  const spaceDays = [];

  for (const space of spaces) {
    const spaceRows = rows.filter((row) => row.spaceId === space.spaceId);
    for (const date of dates) {
      spaceDays.push(sum(spaceRows.filter((row) => row.date === date), "usedMinutes") / 60);
    }
  }

  const dailyAvgHours = dates.map((date) => {
    const dayRows = rows.filter((row) => row.date === date);
    return safeRatio(sum(dayRows, "usedMinutes") / 60, spaces.length);
  });
  const medianDaily = median(dailyAvgHours);
  const hourTotals = [...groupBy(rows, (row) => `${row.date}T${row.hour}`).values()].map(
    (hourRows) => sum(hourRows, "usedMinutes") / 60
  );
  const peakHour = Math.max(...hourTotals, 0);

  return {
    avg: round(safeRatio(totalUsedHours, spaces.length * dates.length), 2),
    zero_day_rate: round(safeRatio(spaceDays.filter((hours) => hours <= 0).length, spaceDays.length) * 100, 1),
    day_variability: round(safeRatio(stddev(dailyAvgHours), dailyAvgHours.reduce((total, value) => total + value, 0) / Math.max(dailyAvgHours.length, 1)), 2),
    peak_day_ratio: round(safeRatio(Math.max(...dailyAvgHours, 0), medianDaily), 2),
    peak_hour_concentration: round(safeRatio(peakHour, totalUsedHours) * 100, 1)
  };
}

function summarizeEvaluation(result) {
  return {
    panel: result.panel,
    metric: result.metric,
    spaceFunction: result.space_function,
    summary: result.summary,
    window: result.window,
    n: result.n,
    evaluations: (result.evaluations || []).map((evaluation) => ({
      indicator: evaluation.indicator,
      unit: evaluation.unit,
      value: evaluation.value,
      status: evaluation.status,
      peerPercentile: evaluation.peer_percentile,
      targetRange: evaluation.target_range,
      reason: evaluation.reason
    }))
  };
}

async function resolveDensityBenchCommand() {
  const explicit = process.env.DENSITY_BENCH_CLI;
  if (explicit) {
    await access(explicit);
    return { command: process.execPath, baseArgs: [explicit], source: explicit };
  }
  return { command: "density-bench", baseArgs: [], source: "density-bench" };
}

async function runDensityBench(commandConfig, args) {
  const { stdout } = await execFileAsync(commandConfig.command, [...commandConfig.baseArgs, ...args], {
    maxBuffer: 1024 * 1024 * 8
  });
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
}

export async function enrichBenchmarks(dashboardData) {
  const warnings = [];
  let commandConfig;

  try {
    commandConfig = await resolveDensityBenchCommand();
  } catch (error) {
    return {
      metadata: {
        status: "skipped",
        reason: `Could not access DENSITY_BENCH_CLI: ${error.message}`
      },
      byFloorType: []
    };
  }

  const rowsByFloorType = groupBy(
    dashboardData.metrics.intervals || [],
    (row) => `${row.floorId}||${row.type}`
  );
  const spacesByFloorType = groupBy(
    dashboardData.dimensions.spaces || [],
    (space) => `${space.floorId}||${space.type}`
  );
  const byFloorType = [];

  for (const [key, rows] of rowsByFloorType) {
    const spaces = spacesByFloorType.get(key) || [];
    const first = rows[0];
    const spaceFunction = benchmarkTypeMap.get(first.type);
    if (!spaceFunction || !spaces.length) continue;

    const values = buildTimeUsedValues(rows, spaces);
    try {
      const evaluation = await runDensityBench(commandConfig, [
        "evaluate",
        "time_used",
        "--space-function",
        spaceFunction,
        "--values",
        JSON.stringify(values),
        "--format",
        "json"
      ]);
      byFloorType.push({
        buildingId: first.buildingId,
        floorId: first.floorId,
        type: first.type,
        mappedBenchmark: spaceFunction,
        metrics: { timeUsed: values },
        timeUsed: summarizeEvaluation(evaluation)
      });
    } catch (error) {
      warnings.push(`${first.floorId} ${first.type}: ${error.message}`);
    }
  }

  return {
    metadata: {
      status: warnings.length && !byFloorType.length ? "failed" : "ok",
      generatedAt: new Date().toISOString(),
      source: commandConfig.source,
      scope: "floor_type",
      warnings
    },
    byFloorType
  };
}
