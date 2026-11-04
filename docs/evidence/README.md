# UI evidence

This directory contains UI evidence for the read-only observatory panel. All
data is the isolated `DEMO` sample; no real run, audit path or credential is
shown.

## Rendered screenshots

Captured on 2026-11-04 with Orca 1.4.247 on macOS, panel width 336 px, current
(dark) theme. The Orca window was minimized for the captures and restored
immediately afterwards. The plugin was **not** loaded into the sidebar, enabled,
or approved.

```sh
# window minimized via the accessibility tree; restored after the captures
orca plugin shot . --scenario ready         --width 336 --theme dark --out docs/evidence/orca-ui-ready.png --json
orca plugin shot . --scenario worker        --width 336 --theme dark --out docs/evidence/orca-ui-worker.png --json
orca plugin shot . --scenario details       --width 336 --theme dark --out docs/evidence/orca-ui-details.png --json
orca plugin shot . --scenario finished      --width 336 --theme dark --out docs/evidence/orca-ui-finished.png --json
orca plugin shot . --scenario no-workers    --width 336 --theme dark --out docs/evidence/orca-ui-no-workers.png --json
orca plugin shot . --scenario large-workers --width 336 --theme dark --out docs/evidence/orca-ui-large-workers.png --json
orca plugin shot . --scenario unavailable   --width 336 --theme dark --out docs/evidence/orca-ui-unavailable.png --json
orca plugin shot . --scenario corrupt       --width 336 --theme dark --out docs/evidence/orca-ui-corrupt.png --json
```

`--scenario` runs the panel and worker against a stand-in host and draws the
resulting tree in Orca's window; it does not open the plugin's sidebar or
approve it. `--json` reported `ok: true`, `settled: true` and `errors: []` for
all eight captures.

| File | Shows |
| --- | --- |
| `orca-ui-ready.png` | Default topology tab: coordinator, direct and nested workers, task/status/attention rows, the 关系异常 group with a missing and an invalid parent, and the detached-task group. |
| `orca-ui-worker.png` | A selected worker expands its detail inline: task, relation, dispatch, attempt, verified and self-reported lifecycle, start confirmation, freshness, worktree basename and self-report. |
| `orca-ui-details.png` | The 细节 tab: run metadata, task counts/table, delivery facts, artifacts and the collapsed events section. |
| `orca-ui-finished.png` | A completed DEMO run with a clean recorded hierarchy, empty attention and no relationship anomalies. |
| `orca-ui-no-workers.png` | Empty topology: "没有 Worker 记录" explicitly says this is not proof that no execution happened. |
| `orca-ui-large-workers.png` | 120 recorded workers: true totals in badges, a visible bounded-list notice and the first 100 root-tree rows. |
| `orca-ui-unavailable.png` | Missing state: unavailable badge, "运行不可用", `progress.json` missing/unreadable message, retry control. |
| `orca-ui-corrupt.png` | Corrupt snapshot: "快照损坏", invalid-JSON message, retry control. |
| `orca-ui-ready-before-fix.png` | Historical pre-topology layout, kept only for comparison with the earlier five-tab design. |

The screenshots at 336 px show the intended narrow-sidebar behaviour: the
topology is a wrapping row list, the two tabs fit, and the task/delivery tables
drop wide columns while keeping their identifying and status columns.

## Interaction evidence

`orca plugin shot --scenario` is a still frame and does not accept `--act`.
Driving the live panel with `--act` would require loading/approving the plugin,
which is out of scope here. The real controls are instead exercised in Orca's
own components-panel runtime by `src/panel.evidence.test.tsx`:

- assert the coordinator/topology render;
- select `w-panel-a1` and assert the inline **Worker 详情**;
- switch to the 细节 tab and assert run metadata;
- switch back, select the finished run, and press refresh while asserting a
  second `runs.list`;
- mount the unavailable and corrupt scenarios and assert their error callouts.

`orca plugin test .` prints the rendered summaries as `UI_EVIDENCE ...` lines;
the captured output is in `ui-interaction-evidence.txt`. The same suite reports
51/51 passing tests, and `orca plugin check .` renders thirteen scenarios
(`unconfigured`, `empty`, `ready`, `finished`, `worker`, `anomaly`, `details`,
`cycle`, `no-workers`, `large-workers`, `stale`, `unavailable`, `corrupt`) with
no panel errors or dropped props.

## Limits

- The screenshots are still frames of scenario renders, not live side-by-side
  animations of a click. The interaction sequence is covered by the component
  runtime test above.
- Orca's window must be minimized or hidden for a scenario shot. The capture
  used a reversible minimize/restore via the macOS accessibility API; the
  window's prior state was restored.
- The screenshots show the current dark theme; no live theme override was used.
- The large-worker still frame shows the top of a bounded list, not all 100
  rows; the true total and the truncation notice are visible above the rows.
