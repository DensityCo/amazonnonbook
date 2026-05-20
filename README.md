# Amazon Non-Bookable Space Usage Dashboard

Static dashboard for exploring utilization of non-bookable spaces in Amazon pilot buildings.

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

This uses `/v3/spaces` to find non-bookable labeled target spaces under the pilot building IDs, then `/v3/analytics/time-used` at hourly resolution for April 20-May 15, 2026 with M-F 9am-5pm operating hours.

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
- 27 floors
- 143 scoped non-bookable spaces
- 22,880 hourly metric rows
- 3,304.76 used hours
- 14.4% overall utilization

## Scope Rules

- Local business hours: Monday-Friday, 9am-5pm, using `LOCAL_DATE_TIME`.
- Non-bookable spaces are identified via the `Non Bookable` label.
- Target types come from labels, not `FUNCTION`.
- Rows where `FUNCTION` is `meeting_room` are excluded.
- Utilization is computed as `sum(TIME_USED_MINUTES) / available interval minutes`.
