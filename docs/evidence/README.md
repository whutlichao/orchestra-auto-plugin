# UI evidence

Every image here is a still frame of the panel drawn by Orca itself, from the
isolated `DEMO` sample (`samples/audit-root` → fixture views in
`src/sample-data.ts`). No real run, audit path or credential is shown.

## Rendered screenshots

Captured on 2026-11-05 with Orca **1.4.248** on macOS, panel width **336 px**
(one capture at **280 px**), current dark theme. The Orca window was minimized
through the macOS accessibility API for each capture and restored afterwards.
The plugin was **not** loaded into the sidebar, enabled or approved: a scenario
shot runs the plugin's code and draws the resulting tree in Orca's window.

```sh
# minimized before every capture, restored after the last one
orca plugin shot . --scenario ready         --width 336 --theme dark --out docs/evidence/orca-ui-ready.png --json
orca plugin shot . --scenario worker        --width 336 --theme dark --out docs/evidence/orca-ui-worker.png --json
orca plugin shot . --scenario anomaly       --width 336 --theme dark --out docs/evidence/orca-ui-anomaly.png --json
orca plugin shot . --scenario cycle         --width 336 --theme dark --out docs/evidence/orca-ui-cycle.png --json
orca plugin shot . --scenario branches      --width 336 --theme dark --out docs/evidence/orca-ui-branches.png --json
orca plugin shot . --scenario deep          --width 336 --theme dark --out docs/evidence/orca-ui-deep.png --json
orca plugin shot . --scenario long-text     --width 336 --theme dark --out docs/evidence/orca-ui-long-text.png --json
orca plugin shot . --scenario large-workers --width 336 --theme dark --out docs/evidence/orca-ui-large-workers.png --json
orca plugin shot . --scenario details       --width 336 --theme dark --out docs/evidence/orca-ui-details.png --json
orca plugin shot . --scenario attention     --width 336 --theme dark --out docs/evidence/orca-ui-attention.png --json
orca plugin shot . --scenario finished      --width 336 --theme dark --out docs/evidence/orca-ui-finished.png --json
orca plugin shot . --scenario no-workers    --width 336 --theme dark --out docs/evidence/orca-ui-no-workers.png --json
orca plugin shot . --scenario stale         --width 336 --theme dark --out docs/evidence/orca-ui-stale.png --json
orca plugin shot . --scenario unavailable   --width 336 --theme dark --out docs/evidence/orca-ui-unavailable.png --json
orca plugin shot . --scenario corrupt       --width 336 --theme dark --out docs/evidence/orca-ui-corrupt.png --json
orca plugin shot . --scenario ready         --width 280 --theme dark --out docs/evidence/orca-ui-narrow-280.png --json
```

`--json` reported `ok: true`, `settled: true` and `errors: []` for all sixteen
captures.

| File | Shows |
| --- | --- |
| `orca-ui-ready.png` | Default view: one-line run summary, the coordinator card, the `顶层 Worker · 未记录父关系` group, and the record-based node/link graph with three hierarchy levels. Node cards carry only name, task and status; the relationship-anomaly group follows. |
| `orca-ui-worker.png` | A nested worker selected by clicking its card: the detail expands under that node with its recorded parent, dispatch, attempt, both lifecycles, start confirmation, freshness, worktree basename and self-report. |
| `orca-ui-anomaly.png` | Missing and invalid parent edges: the anomaly group lists them apart, with `父节点缺失` / `父关系无效` markers and no parent connector. |
| `orca-ui-cycle.png` | A two-worker parent cycle: both members stay in the danger-toned anomaly group, no edge is drawn, and the run has no top-level workers. |
| `orca-ui-branches.png` | Three top-level workers with their own children and one grandchild: multiple branches at two record depths. |
| `orca-ui-deep.png` | A recorded chain: each level indents by one rail cell while the trunk and elbow stay visible; the eight visible levels still fit 336 px. |
| `orca-ui-long-text.png` | Long worker ID and long task title: the node truncates both, the inline detail wraps the full values with no horizontal overflow. |
| `orca-ui-large-workers.png` | 120 recorded workers: `100 / 120` next to the group label, 100 rendered node rows, true totals. |
| `orca-ui-details.png` | The `运行详情` section opened on demand: run metadata, tasks, delivery facts, artifacts and the collapsed events section. |
| `orca-ui-attention.png` | The `关注事项` section opened on demand with the recorded blocked task. |
| `orca-ui-finished.png` | A completed DEMO run with a clean hierarchy and no attention items. |
| `orca-ui-no-workers.png` | Empty worker projection: the empty state says this is not proof that no execution happened. |
| `orca-ui-stale.png` | Stale observation: the `时效 已过期` badge in the summary line plus the one-line warning. |
| `orca-ui-unavailable.png` | Missing state: unavailable badge, "运行不可用", the progress.json message and a retry control. |
| `orca-ui-corrupt.png` | Corrupt snapshot: "快照损坏" and the invalid-JSON message. |
| `orca-ui-narrow-280.png` | The same view at 280 px: summary, badges, cards and task lines wrap instead of overflowing. |

## Connector evidence

The graph draws edges as real elements in the host's own tokens, not as text
indentation:

- each row renders one `Box` rail cell per recorded ancestor whose trunk
  continues past it, filled with the host's `muted` background;
- the row's own elbow is a 2 px vertical stem, a 2 px horizontal tick and, when
  a later sibling exists, a 2 px trunk down to the row's bottom edge;
- a top-level row (`parent_worker_id` absent) renders no incoming edge at all,
  and cycle members render no parent edge, so the picture never claims a
  relationship that was not recorded.

`src/graph.test.ts` asserts the planner's rail flags and cut counts;
`src/panel.test.tsx` asserts that drawn edge segments exist for recorded parents
and that an all-roots projection has none.

## Interaction evidence

`orca plugin shot --scenario` is a still frame and does not accept `--act`.
Driving the live panel with `--act` would require loading and approving the
plugin, which is out of scope here. The real controls are exercised in Orca's
own components-panel runtime by `src/panel.evidence.test.tsx`:

- assert the coordinator card, the `顶层 Worker · 未记录父关系` group and the
  recorded hierarchy;
- press the `w-panel-a1` node card (a `ListItem`, i.e. a real button) and assert
  the inline **Worker 详情**;
- toggle **运行详情** open, assert run metadata, toggle it closed again;
- switch to the finished run and press refresh while asserting a second
  `runs.list`;
- mount the unavailable and corrupt scenarios and assert their error callouts.

`orca plugin test .` prints the rendered summaries as `UI_EVIDENCE ...` lines;
the captured output is in `ui-interaction-evidence.txt`. The same suite reports
59/59 passing tests, and `orca plugin check .` renders seventeen scenarios with
no panel errors or dropped props:

`unconfigured`, `empty`, `ready`, `finished`, `worker`, `anomaly`, `details`,
`cycle`, `attention`, `branches`, `deep`, `long-text`, `no-workers`,
`large-workers`, `stale`, `unavailable`, `corrupt`.

## Limits

- Screenshots are still frames of scenario renders, not a video of a click. The
  interaction sequence is covered by the component-runtime test above.
- Orca's window must be minimized or hidden for a scenario shot; the capture
  used a reversible minimize/restore, and the window state was restored.
- A still frame is capped at one window height (1122 px here), so a long graph
  can push a lower section below the frame. `details` and `attention` therefore
  use a one-worker fixture so the on-demand section is inside the frame.
- Only the dark theme is captured. The panel uses host tokens, so a light theme
  paints the same tree with the host's own colours.
- `orca plugin types .` cannot run on this Orca build because the app bundle
  ships no `resources/plugins/declarative/*.d.ts`; the panel's types are
  therefore checked by `orca plugin check` (real component catalog and props)
  rather than by `tsc`.
