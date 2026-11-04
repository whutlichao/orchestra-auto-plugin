# UI evidence

Every image here is a still frame of the panel drawn by Orca itself, from the
isolated `DEMO` sample (`samples/audit-root` → fixture views in
`src/sample-data.ts`). No real run, audit path or credential is shown.

## Pre-fix capture

`before/orca-ui-roots-stale-before.png` is the same `roots-stale` scenario drawn
by the previous implementation (`587257e`): six full-width cards, no connector
from the coordinator, and `观测过期` repeated on every node. It is the before
frame for this fix; every other PNG in this folder is a current render.

## Rendered screenshots

Captured on 2026-11-05 with Orca **1.4.248** on macOS, panel width **336 px**
(one capture at **600 px**, one at **280 px**), current dark theme. The Orca
window was minimized through the macOS accessibility API before the captures and
restored afterwards. The plugin was **not** loaded into the sidebar, enabled or
approved: a scenario shot runs the plugin's code and draws the resulting tree in
Orca's window.

```sh
# minimized before the captures, restored after the last one
orca plugin shot . --scenario roots-stale   --width 336 --theme dark --out docs/evidence/orca-ui-roots-stale.png --json
orca plugin shot . --scenario roots-stale   --width 600 --theme dark --out docs/evidence/orca-ui-wide-600.png --json
orca plugin shot . --scenario roots-stale   --width 280 --theme dark --out docs/evidence/orca-ui-narrow-280.png --json
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
```

`--json` reported `ok: true`, `settled: true` and `errors: []` for all eighteen
captures.

| File | Shows |
| --- | --- |
| `orca-ui-roots-stale.png` | The page shape that started this fix: six top-level workers with no recorded parent, all on a stale snapshot. The coordinator hub, a drawn spine, two lanes of compact node cards and one dashed membership tick per worker; the stale observation appears once in the summary and not on the nodes. |
| `orca-ui-wide-600.png` | The same projection at 600 px: the two lanes widen and the full task titles fit; the hub stays centred over the spine. |
| `orca-ui-narrow-280.png` | The same projection at 280 px: both lanes, all six ticks and all node cards still draw; long identifiers truncate and the detail keeps the full values. |
| `orca-ui-ready.png` | The recording-based graph: two members, a recorded two-level chain in the left lane, the anomaly group with missing/invalid parents. Dashed ticks mark membership, solid rails mark recorded parentage. |
| `orca-ui-worker.png` | A nested worker selected through the persisted `selectedWorkerId` (the press path itself is covered by the component-runtime test): the detail expands full width under its lane pair with its recorded parent, dispatch, attempt, both lifecycles, start confirmation, freshness, worktree basename and self-report. |
| `orca-ui-anomaly.png` | Missing and invalid parent edges: the anomaly group lists them apart with `父节点缺失` / `父关系无效`, no membership tick and no parent connector. |
| `orca-ui-cycle.png` | A two-worker parent cycle: both members stay in the danger-toned anomaly group, the hub reports 0 top-level workers, and no edge is drawn. |
| `orca-ui-branches.png` | Three top-level members with their own recorded children and a grandchild: the members pair into lanes and each recorded subtree stays in its member's lane. |
| `orca-ui-deep.png` | A recorded chain: each level indents by one rail cell inside the lane while the solid rail and elbow stay visible; rows beyond the depth limit move to the anomaly group. |
| `orca-ui-long-text.png` | A long worker ID and long task title: the node truncates both, the full-width detail wraps the full values with no horizontal overflow. |
| `orca-ui-large-workers.png` | 120 recorded workers: `100 / 120 顶层` and `100 / 120 节点` in the graph header, 100 rendered nodes (50 lane pairs), true totals. |
| `orca-ui-details.png` | The `运行详情` section opened on demand: run metadata, tasks, delivery facts, artifacts and the collapsed events section. |
| `orca-ui-attention.png` | The `关注事项` section opened on demand with the recorded blocked task. |
| `orca-ui-finished.png` | A completed DEMO run with a clean hierarchy and no attention items. |
| `orca-ui-no-workers.png` | Empty worker projection: the empty state says this is not proof that no execution happened. |
| `orca-ui-stale.png` | A stale projection: one `时效 已过期` badge and the compact `过期≠失败` phrase in the run summary; no node repeats a stale badge. |
| `orca-ui-unavailable.png` | Missing state: unavailable badge, "运行不可用", the progress.json message and a retry control. |
| `orca-ui-corrupt.png` | Corrupt snapshot: "快照损坏" and the invalid-JSON message. |

## Connector evidence

The graph draws edges as real elements in the host's own border tokens, not as
text indentation:

- **Run membership**: a 28 px spine cell holds a 2 px accent trunk; each occupied
  lane gets a 2 px dashed accent tick (three short strokes). Every top-level
  worker has exactly one tick. Anomalies get none, so no unresolved parent is
  ever attached to the coordinator.
- **Recorded parentage**: a child row draws a 1 px solid accent rail at its
  elbow, one rail cell per recorded ancestor whose trunk continues past it, and
  the child indents by one 6 px rail cell per level. Membership is dashed and
  thick, parentage is solid and thin, so the legend's two kinds are
  distinguishable without relying on colour.
- The elbow meets the child card below its rounded corner, so the tick ends on
  the straight left border rather than in the corner curve.
- A lane's branch rails are inset 4 px from the lane edge, keeping a recorded
  chain visibly clear of the coordinator spine.
- The selected node's detail is drawn full width under its lane pair: a 146 px
  lane never squeezes the recorded facts.

`src/graph.test.ts` asserts the lane pairing, the member blocks and the cut
counts; `src/panel.test.tsx` asserts that six top-level workers produce 18
membership tick strokes, that an all-roots projection has zero recorded-parent
lines, and that `观测过期` appears zero times on nodes while the summary carries
the stale state once.

## Interaction evidence

`orca plugin shot --scenario` is a still frame and does not accept `--act`.
Driving the live panel with `--act` would require loading and approving the
plugin, which is out of scope here. The real controls are exercised in Orca's
own components-panel runtime by `src/panel.evidence.test.tsx`:

- assert the coordinator hub, the `运行归属图` header and the recorded lanes;
- press the `w-panel-a1` node card (a `ListItem`, i.e. a real button) and assert
  the full-width **Worker 详情**;
- press the same node again to close it, then select it again and press
  `收起详情` to close it from the detail header;
- toggle **运行详情** open, assert run metadata, toggle it closed again;
- switch to the finished run and press refresh while asserting a second
  `runs.list`;
- mount the unavailable and corrupt scenarios and assert their error callouts.

`orca plugin test .` prints the rendered summaries as `UI_EVIDENCE ...` lines;
the captured output is in `ui-interaction-evidence.txt`. The same suite reports
66/66 passing tests, and `orca plugin check .` renders eighteen scenarios with
no panel errors or dropped props:

`unconfigured`, `empty`, `ready`, `finished`, `worker`, `anomaly`, `details`,
`cycle`, `attention`, `roots-stale`, `branches`, `deep`, `long-text`,
`no-workers`, `large-workers`, `stale`, `unavailable`, `corrupt`.

## Limits

- Screenshots are still frames of scenario renders, not a video of a click. The
  interaction sequence is covered by the component-runtime test above.
- Orca's window must be minimized or hidden for a scenario shot; the capture
  used a reversible minimize/restore, and the window state was restored.
- A still frame is capped at one window height (1122 px here), so a long graph
  can push a lower section below the frame. `details` and `attention` therefore
  use a one-worker fixture so the on-demand section is inside the frame;
  `large-workers` and `deep` are deliberately cropped at the bottom.
- Only the dark theme is captured. The panel uses host tokens, so a light theme
  paints the same tree with the host's own colours.
- The two-lane layout trades width for compactness: a long recorded chain
  narrows inside its lane and a run with one top-level worker leaves the other
  lane empty. Node identities stay reachable through the full-width detail.
- `orca plugin types .` cannot run on this Orca build because the app bundle
  ships no `resources/plugins/declarative/*.d.ts`; the panel's props are
  therefore checked by `orca plugin check` (real component catalog and props)
  rather than by `tsc`.
