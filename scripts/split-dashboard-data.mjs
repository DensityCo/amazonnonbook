import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || path.join("data", "dashboard-data.json");
const outputDir = process.argv[3] || "data";

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const catalog = {
  metadata: data.metadata,
  dimensions: data.dimensions,
  metrics: {}
};
const metrics = {
  metadata: {
    generatedAt: data.metadata?.generatedAt,
    requestedRange: data.metadata?.requestedRange,
    includedRange: data.metadata?.includedRange,
    apiAudit: data.metadata?.apiAudit
  },
  dimensions: {
    dates: data.dimensions?.dates
  },
  metrics: data.metrics
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "catalog.json"), `${JSON.stringify(catalog)}\n`);
fs.writeFileSync(path.join(outputDir, "metrics.json"), `${JSON.stringify(metrics)}\n`);

console.log(`Wrote ${path.join(outputDir, "catalog.json")} and ${path.join(outputDir, "metrics.json")}`);
