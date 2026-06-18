# Amazon Non-Bookable Simultaneous Use

Standalone delight for simultaneous utilization of Amazon non-bookable spaces. This is the
simultaneous-use experience only; it is not the broader `amazonnonbook` dashboard.

## Run locally

```sh
npm run serve
```

Open `http://localhost:4174`.

The delight starts with no buildings selected. Choose one or more buildings, or `All`, before charts and tables aggregate.

## Rebuild data

Put a Density API token at:

```text
env/density-api-token.txt
```

Then run:

```sh
npm run build:api
```

The build flow:

- Reads `/v3/spaces`.
- Keeps spaces with a `Non Bookable` or `Non-Bookable` label.
- Uses the companion label as the space type filter where possible.
- Keeps only spaces with presence-health status `healthy`, `degraded`, or `offline`.
- Pulls `/v3/analytics/sessions/raw` and stores five-minute simultaneous-use concurrency rows.

## Check Against Atlas CSV

Atlas `spaces.csv` exports can be used as a source-of-truth check against the raw-session dashboard:

```sh
npm run check:atlas-csv -- data/dashboard-data.json "/path/to/spaces.csv"
```

The check matches CSV rows to the labeled non-bookable spaces already in the dashboard catalog, converts 15-minute `TIME_USED_MINUTES` into comparable five-minute average-active contributions, and reports the CSV metrics next to the raw-session dashboard metrics.

Hourly simultaneous utilization is calculated as average active spaces across the twelve five-minute slices in an hour, divided by all selected non-bookable spaces in the current filter scope. Raw-session concurrency counts occupied `session_type: "1"` sessions only.
