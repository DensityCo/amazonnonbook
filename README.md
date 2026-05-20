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

## Density Benchmarks

`npm run build:api` also enriches the generated dashboard data with Density portfolio benchmark context when the `density-bench` CLI is available.

Recommended local setup:

```sh
cd /path/to/density-benchmarks-CLI
npm link
cd /path/to/amazonnonbook
npm run build:api
```

If the CLI is not linked, point directly at it:

```sh
DENSITY_BENCH_CLI=/path/to/density-benchmarks-CLI/src/cli/index.js npm run build:api
```

The benchmark step evaluates each supported floor/type group against the `time_used` portfolio panel and writes results to `benchmarks.byFloorType` in `data/dashboard-data.json`. The dashboard renders the selected type's healthy-indicator count, floors with concerns, and top out-of-range indicators.

Supported mappings:

| Dashboard type | Density benchmark function |
|---|---|
| Phone Booth / Phone Room | `phone_booth` |
| Focus | `enclosed_workspace` |
| Huddle / Flex | `open_collaboration_space` |
| Quiet Room / Lactation/Mothers Room / Interfaith Room | `wellness_room` |

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
