# progress.json read contract

This document records what the observatory reads and how it derives each shown
value. The source of truth is the orchestra-auto-zh reference
(`references/progress-dashboard.md`) and its `scripts/progress.py`; this plugin
reads the same snapshot but never writes it.

## Snapshot shape

`progress.json` is UTF-8 JSON. Schema **v1** and **v2** are accepted. The
required top-level fields are:

| Field | Type | Observed use |
| --- | --- | --- |
| `schema_version` | `1` or `2` | Shown as `v1`/`v2`. Any other value is a corrupt snapshot. |
| `run` | object | Run status and history. |
| `tasks` | object keyed by task ID | Task rows. |
| `workers` | object keyed by worker ID | Worker rows. |
| `deliveries` | object keyed by task ID | Delivery facts. |
| `artifacts` | object keyed by artifact ID | Artifact labels and kinds. |
| `receipts` | object | Required by the contract, **never exposed**; only checked for being an object. |
| `events` | array | Recent events. |

Every top-level object key must be a portable identifier
(`[A-Za-z0-9_.:-]{1,128}`), except event entries. A missing required field, a
non-object collection, or a non-list `events` marks the snapshot **corrupt**.

## `run`

| Field | Rule |
| --- | --- |
| `id` | Required portable identifier. |
| `target_repo` | Required non-empty string for structural validation; **never rendered or followed**. The recorder's write-side existence/separation guard is deliberately not repeated: following that path would leave the configured audit roots. |
| `status` | One of `unknown`, `active`, `waiting_user`, `failed`, `paused`, `completed`, `cancelled`; other values render as unknown. |
| `health` | One of `healthy`, `degraded`, `blocked`, `lost`, `unknown`; a present invalid value is corrupt. Missing renders unknown. |
| `mode` | `REAL` or `DEMO`; other values render unknown. DEMO is called out in the panel. |
| `phase`, `title`, `summary` | Trimmed and length-capped display strings. |
| `orca_run_id` | Null or portable identifier; invalid non-null values are corrupt. |
| `started_at`, `updated_at`, `last_observed`, `last_effective_progress`, `ended_at` | ISO timestamps; invalid values render unknown. |

`last_observed` drives freshness:

- missing/unparseable → `unknown`
- `now - last_observed >= 300s` → `stale`
- otherwise → `current`

Freshness is an age signal, not a verdict. Future timestamps are treated as
current, mirroring the reference reader.

## `tasks`

Each value is an object; the key is the task ID. Read fields:

| Field | Rule |
| --- | --- |
| `title` | Display fallback is the ID. |
| `status` | One of `unknown`, `pending`, `ready`, `running`, `blocked`, `waiting_user`, `reported`, `accepted`, `rejected`, `failed`, `paused`, `cancelled`; other values render unknown. |
| `dependencies` | Portable IDs, up to 20 rendered. A dependency on an unrecorded task remains just an ID. |
| `blocked_reason`, `pending_decision` | Display strings; non-empty values create attention items. |
| `provisional`, `orca_task_id` | A non-boolean `provisional` or an invalid non-null `orca_task_id` is corrupt. |
| `verified_at` | Timestamp; invalid renders unknown. |

Task counts are actual counts by recorded status, including `unknown`, plus the
actual total. There is no completion percentage and no inferred scheduler state.

## `workers`

Each value is an object; the key is the worker ID. Read fields:

| Field | Rule |
| --- | --- |
| `task_id`, `dispatch_id`, `parent_worker_id` | Portable IDs or unknown. |
| `attempt` | Positive integer, otherwise unknown. |
| `lifecycle`, `reported_lifecycle` | Worker lifecycle enums; unknown on missing/other values. |
| `start_confirmation` | `unknown`, `observed`, `unobserved`, or the v1 value `unsupported`; shown separately from lifecycle. |
| `worktree` | Only the basename is rendered; the full path is discarded. |
| `reported_summary` | Display string; it is a self-report, not acceptance. |
| `last_observed`, `verified_at` | Timestamps; `last_observed` drives the worker freshness column. |

Self-reported values never update verified lifecycle, task status or delivery
facts in this projection.

## `deliveries`

Each value is an object keyed by task ID. The four boolean fields are
`implemented`, `integrated`, `merged`, `tracker_closed`. They are read strictly:

| Stored value | Rendered |
| --- | --- |
| `true` | 是 (verified yes) |
| `false` | 否 (verified no) |
| `null` or missing | 未核验 (unverified) |

The summary counts are computed per task ID across the union of task IDs and
delivery keys, so a task with no delivery record contributes four unverified
values. `deliveryMissingTasks` counts tasks without a delivery record. A PR
artifact does not set any delivery field.

`evidence` is counted but its reference values are **not rendered**.

## `artifacts` and `events`

Artifacts expose `kind` (`report`, `test`, `commit`, `pr`, `other`), `label` and
the task ID. The `reference` value is discarded. The panel says explicitly that
only labels are shown.

Events expose a capped recent window (20) sorted by `at` descending: type,
source, summary, and whether the entry is bookkeeping. Invalid event entries are
skipped with a visible warning; a non-boolean `bookkeeping` is corrupt.
Heartbeat events are not treated as effective progress by this read-only panel.

## Attention items

The panel lists only recorded problem signals:

- a task with status `blocked` or a non-empty `blocked_reason`
- a task with status `waiting_user` or a non-empty `pending_decision`
- a task with status `failed` or `rejected`
- a worker with verified lifecycle `failed` or `lost`
- a worker whose self-report is `failed` while its verified lifecycle is not
  (marked as unverified self-report)

Run health is shown separately as a badge and a callout, not in this list.
Nothing else is inferred. In particular, a stale observation is a separate
warning, not an attention item or a failure.

## Redaction

The view model intentionally excludes:

- `run.target_repo`
- state paths and the registry home
- full worktree paths (basename only)
- artifact `reference` values
- delivery `evidence` values (count only)
- `receipts`

No file contents are read beyond `progress.json` and validation-sized registry
descriptors. No path from the panel is accepted; the panel sends a run ID and
the worker resolves it against its own discovery result.

## Limits

| Limit | Value |
| --- | --- |
| snapshot bytes | 8 MiB |
| discovery bytes per pass | 64 MiB |
| audit roots | 16 |
| registry descriptors | 200 |
| directory entries scanned per root | 1000 |
| runs listed | 200 |
| task/worker/delivery view arrays | 500 each |
| task/worker/delivery rows rendered | 100 each |
| attention records projected | 100 |
| attention items rendered | 20 |
| artifacts projected / rendered | 100 / 50 |
| events projected / rendered | 20 / 20 |
| stale threshold | 300 s |

The projected arrays are capped so a single worker answer stays below the host's
1 MiB response limit. Counts (`taskCounts.total`, `workerTotal`,
`deliveryTotal`, `attentionTotal`, `artifactTotal`, `eventTotal`) always reflect
the whole snapshot, and the panel states the true total when it truncates rows.

Hitting a limit sets a visible truncation or warning; it never silently claims
full coverage.
