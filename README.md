# Amazon Sensor-Backed Space Usage Dashboard

Static dashboard for exploring utilization of sensor-backed spaces in Amazon pilot buildings.

The checked-in sample data is generated from:

`/Users/roychan/Downloads/Density Inc._SJC31 - Sunnyvale_undefined_15min_20260504-20260515_8a-6p/spaces.csv`

and its sibling `labels.csv`.

## Run

```sh
npm run build:api
npm run serve
```

Then open `http://localhost:4173`.

## API Token

For Density API pulls, put the token here:

`env/density-api-token.txt`

The file should contain only the token value on one line. The `env/` directory is ignored by git.

Then build from the Density API:

```sh
npm run build:api
```

This uses `/v3/spaces` to find spaces under the pilot building IDs, `/v3/analytics/presence-health` to keep only spaces with `healthy`, `degraded`, or `offline` presence-health status, then `/v3/analytics/time-used` at hourly resolution for April 20-May 15, 2026 with M-F 9am-5pm operating hours.

To rerun only the presence-health audit:

```sh
npm run audit:presence-health
```

## Dashboard Views

- **Space Type Detail**: select one type and inspect per-space/day usage, peak active demand, shortage-risk hours, hourly weekday shape, and individual space drill-downs.
- **Space Type Comparison**: compares all space types across the selected buildings/floors using normalized metrics such as average hours per space per day, median hours per space per day, peak active share, shortage-risk hours, underused spaces, and busiest weekday/hour.

The building and floor filters are multi-select pill filters. Choose `All` for the full pilot portfolio, or select any subset of buildings/floors.

## Optional Benchmark Context

If a benchmarking CLI generates context for the current data, write it to:

`data/benchmark-context.json`

The dashboard will show that context at the top of the Space Type Comparison tab. This file is ignored by git because benchmark output may contain customer-specific context. See `data/benchmark-context.example.json` for the expected shape.

## Current Data Coverage

`data/dashboard-data.json` is generated locally from the Density API and is intentionally not committed because it contains customer workplace usage data. With a valid token, `npm run build:api` generates data covering SEA25, SEA37, SEA44, and SJC31 from Monday, April 20 through Friday, May 15, 2026.

Latest local generated audit:

- 4 buildings
- 29 floors
- 289 spaces with confirmed presence sensors
- 46,240 hourly metric rows
- 7,734.53 used hours
- 16.7% overall utilization

## Scope Rules

- Local business hours: Monday-Friday, 9am-5pm, using `LOCAL_DATE_TIME`.
- Only spaces with `/v3/analytics/presence-health` status `healthy`, `degraded`, or `offline` are included.
- `unknown` and spaces not returned by the presence-health endpoint are excluded.
- Target types come from normalized labels first, then `FUNCTION`/space name fallback.
- Utilization is computed as `sum(TIME_USED_MINUTES) / available interval minutes`.
