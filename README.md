# orchestra-auto observatory

A read-only Orca sidebar panel for [orchestra-auto](https://github.com/whutlichao/orchestra-auto)
runs. Its main view is a drawn node-and-link graph: a coordinator card, a spine,
one dashed membership tick per top-level worker, and one solid connector per
recorded `parent_worker_id`, laid out in two compact lanes so several workers fit
one narrow sidebar. A node shows only the worker's name, its task and its status;
clicking one expands its recorded facts full width. Run attention and run details
open on demand, and the stale observation is stated once instead of on every
node. Missing, orphaned, invalid, cyclic, stale, corrupt and unavailable data
each keep an explicit state. The panel does not write run state, execute
orchestration, control a worker, or call Orca hooks.

## Quick start (中文)

1. 在 Orca 中安装/加载本插件（`trusted-worker`，仅申请 `settings:own`）。
2. 打开 Settings → Plugins → orchestra-auto，把“本地审计目录”设为一个或多个绝对路径，每行一个。
3. 打开右侧栏的 **orchestra-auto** 面板；选择运行并点刷新。
4. 想先看样例：把审计目录设为仓库中的 `samples/audit-root` 的绝对路径。样例标记为 DEMO，不代表真实执行或验收。

## Read-only guarantees

- No write to `progress.json`, the registry, run state, or any project file.
- No orchestration command, worker action, terminal command, hook, or network request.
- The only capability requested is `settings:own`, used to read the two configuration values.
- The panel sends a run **ID**, never a path. The worker resolves that ID against its own discovery result.

## Install

Requires Orca `>=1.4.248`; tested on Orca `1.4.248` on macOS. The floor matches the components catalog this panel uses: `Box` (catalog 4, 1.4.248) draws the graph's rails and elbows, together with the catalog-2 components (Table, Tabs, KeyValue, Collapsible, ListItem and the rest).

For development, from this repository:

```sh
orca plugin dev load /absolute/path/to/orchestra-auto-plugin
```

Orca shows the access this plugin asks for. Approve it only after reviewing the
code and only if you intend to run this plugin; the approval is your decision.
To install from the repository instead, use Orca's Git/plugin install flow with
`https://github.com/whutlichao/orchestra-auto-plugin`; Orca derives the publisher
from the repository owner.

Then open the **orchestra-auto** panel in Orca's right sidebar.

## Configure

Open **Settings → Plugins → orchestra-auto**:

| Setting | Meaning |
| --- | --- |
| 本地审计目录 (`auditRoots`) | One absolute path per line. A run state is readable only when its `progress.json` lives under one of these roots. Empty means the plugin reads nothing. |
| progress 注册表 (`registryHome`) | The orchestra-auto singleton registry, default `~/.orca/progress`. Only descriptors are read from here; a descriptor's state path must still be inside an audit root. Empty disables registry discovery. |

Discovery uses two sources, and only while at least one audit root is usable:

1. **Audit roots**. If a root itself contains `progress.json`, it is one run;
   otherwise each direct child directory containing `progress.json` is a run.
   The scan is one level deep, not recursive.
2. **Registry descriptors** in `<registryHome>/runs/*.json`. The descriptor's
   `state_path` is accepted only if it is inside a configured audit root and has
   no symlink component.

Empty `auditRoots` reads nothing, including the registry. With no usable audit
root, the worker reports that instead of reading descriptors. A run registered
in `~/.orca/progress` but whose state is outside every configured audit root
appears as unavailable and is never read.

Audit roots should be real paths, not symlinks, and outside Git repositories for
real audit data. The repository's `samples/audit-root` is an intentional
read-only fixture exception for trying the panel.

## Sample data

```text
samples/audit-root/
├── demo-active/     # running DEMO run with blocked/decision/attention
├── demo-finished/   # completed DEMO run with verified deliveries
└── demo-corrupt/    # deliberately invalid JSON
```

Set `auditRoots` to the absolute path of `samples/audit-root` and refresh. The
DEMO badge and the warning in the panel make clear that this is not real
evidence. `demo-corrupt` demonstrates the corrupt state. See
[`samples/README.md`](samples/README.md).

## What the panel shows

The panel has one main view and two on-demand sections. The run summary is a
single line under the run selector: status, worker count, attention count,
observation time and only the exceptional badges (DEMO, stale, degraded health,
unavailable).

### 运行拓扑 (the graph)

The coordinator is a compact card centred above a drawn spine. Under it, workers
are compact cards in two lanes, so six top-level workers take three rows instead
of six full-width cards. Connections mean exactly one of two recorded facts:

- **Dashed ticks from the spine = run membership.** A worker whose recorded
  `parent_worker_id` is absent is attached to the coordinator by a 2 px dashed
  tick. It is the only edge to the coordinator and it never claims parentage: the
  node detail says `未记录父 Worker`, and the legend under the graph says
  `虚线＝运行归属`.
- **Solid lines = a recorded parent.** A `parent_worker_id` that resolves inside
  the projection draws a 1 px solid elbow from its parent card in the same lane.
  Each recorded level indents by one rail cell, so recorded chains stay readable
  (12 levels; deeper rows move to the anomaly group instead of being dropped).
  The legend distinguishes it as `实线＝已记录父 Worker`.

Neither kind is inferred from a name, list order or lane: `src/graph.ts` plans the
members from the topology, then pairs the member blocks into lanes. The panel
draws every edge as a real `Box` line in the host's border tokens rather than as
text indentation.

- A node shows three facts: the worker name, its recorded task (or `未记录` /
  `记录无效` / `<id>（未记录于 tasks）`) and its verified lifecycle badge.
  Recorded attention, an unobserved start and a relation gap add a marker badge.
  Stale observation is deliberately not a node marker: it is one run-level fact
  in the summary (`时效 已过期` plus `过期≠失败，也不代表没有进展`), so a stale
  run does not repeat the same badge on every node.
- Selecting a node (click, Enter or Space: the card is a real button) expands its
  detail full width under its lane pair: task, relation, dispatch, attempt,
  verified and self-reported lifecycle, start confirmation, freshness, worktree
  basename, self-report summary and its recorded attention items. Selecting it
  again, or pressing `收起详情`, closes it.
- The **图例与说明** collapsible holds the long explanation (membership vs
  parentage, stale semantics, the click behaviour), so the main view stays
  compact.

The **关系异常** group keeps unresolved edges explicit and never attaches them to
the coordinator:

| Situation | Shown as |
| --- | --- |
| `parent_worker_id` is absent/null | `运行归属图` lane with a dashed membership tick and no parent edge. |
| `parent_worker_id` is recorded but the parent is not in the projected workers | `父节点缺失` badge; `父 <id> 未记录` in the detail. |
| `parent_worker_id` is present but not a portable ID | `父关系无效` badge; the raw value is not rendered. |
| Parent chain cycles | `父关系成环`; members are listed together with danger tone, no edge. |
| Parent chain exceeds the 12-worker display depth | `层级过深`; listed flat in the anomaly group, with a "N 个因层级过深而平铺" note. |
| Parents exist beyond the 500-worker projection cap | `父节点未读取`; `父 <id> 不在已读取的 Worker 中`, not reclassified as missing. |

An anomaly is never joined to the coordinator by a membership tick either: the
group states `未并入协调者`, and its workers get no line to the spine.

Tasks are linked only by each worker's recorded `task_id`:

- A missing `task_id` renders `未记录`; an invalid one renders `记录无效`.
- A `task_id` that names no recorded task renders `<id>（未记录于 tasks）`.
- Recorded tasks with no worker pointing at them sit in the collapsed
  **未关联任务** section; "unassociated" does not mean "not executed".

### 关注事项 (on demand)

The collapsed **关注事项** section holds only recorded problem signals (blocked or
pending-decision tasks, failed/rejected tasks, failed/lost workers, and run-level
waiting/failed states). Stale observation is one run-level phrase in the
summary, never a failure; with nothing recorded, the panel says so in one line
instead of an empty section.

### 运行详情 (on demand)

The collapsed **运行详情** section holds the secondary facts:

- **运行元数据**: run ID, Orca run ID, mode, phase, schema, source and timestamps.
- **任务**: status counts and a table with each task's status, worker count,
  dependencies, notes and its recorded Orca task ID when one exists. The worker
  count is the number of recorded `task_id` references; 0 is not proof that no
  work happened.
- **交付事实**: strict `true` / `false` / unverified counts for `implemented`,
  `integrated`, `merged` and `tracker_closed`, plus the per-task table.
- **产物**: artifact kind, label and task ID only; references are not rendered.
- **最近事件**: a collapsed summary of the latest recorded events.

Missing, unknown and stale values are rendered as such. A missing delivery is
**unverified**, never success. A `completed` run status is shown as recorded
state, not as independent acceptance.

### Host UI capability

Orca supports two panel UI kinds: `html` (a page in an isolated frame) and
`components` (the panel returns a tree of catalog components, which Orca draws
with its own controls). The panel stays a `components` panel: its data comes
from the worker bridge, and an `html` frame would drop that bridge and force a
different read model. Orca 1.4.248's catalog 4 adds `Box`, which exposes
width/height tokens, host colour tokens, border tones and stretch layout, so the
spine, dashed membership ticks and solid parent elbows are real drawn elements in
the host theme rather than text indentation. No extra capability or
security-model change is involved: the manifest still asks only for
`settings:own`.

### Narrow sidebar, empty and large data

- The graph puts two equal lanes around a 28 px spine, so a 336 px sidebar (or
  280 px) still draws every node, every membership tick and every recorded parent
  edge. Nodes stay compact (name, task, status) and truncate long identifiers or
  titles; the full values are in the selected detail. When one lane's recorded
  branch is deeper than the other's, the shorter lane leaves vertical space
  rather than inventing a sibling.
- Wide task/delivery columns are dropped below 480 px, leaving the identifying
  and status columns.
- A run with no `workers` shows an explicit empty state that says this is not
  proof that no execution happened. A missing projection with a positive
  `workerTotal` is called out instead of shown as empty.
- At most 100 nodes in the top-level graph (members plus their recorded
  children, i.e. up to 50 lane pairs) and 100 nodes in the anomaly graph are
  drawn; a cut row says how many of its descendants are hidden, and the header
  plus a note always carry the true totals. At most 50 detached tasks are listed.

## Privacy and safety boundaries

The worker enforces these before reading a file:

- Only state paths under a configured audit root are touched; registry
  descriptors outside those roots are never resolved.
- Symlinks are refused at every path component, including `progress.json` and
  descriptor files. Traversal (`..`), relative paths, NUL bytes and non-portable
  run IDs are refused.
- The file system root and the user's home directory are refused as audit roots.
- Snapshots are read with `O_NOFOLLOW` and a size limit; a path from the panel is
  never accepted.
- The panel never renders state paths, `target_repo`, full worktree paths
  (basename only), artifact/evidence reference values, or recorder receipts.
- No external assets, URLs or network calls are loaded.

Limits: 8 MiB per snapshot, 64 MiB per discovery pass, 16 audit roots, 200
registry descriptors, 1000 directory entries per root, 200 runs, 500 projected
tasks/workers/deliveries, 100 rendered graph nodes in the top-level group (up to
50 lane pairs), 100 rendered graph nodes in the anomaly group, 50 detached
tasks, 12 displayed worker levels, 100 rows per task or delivery table, 50
artifacts, 100 projected attention records (10 rendered), and 20 events. Counts
remain complete, and truncation is shown with the true total.

## Development

```sh
orca plugin validate .
orca plugin test .      # unit, worker and panel tests
orca plugin check .     # validates and renders every panel.check.ts scenario
```

The tests use snapshots produced by the real orchestra-auto recorder; see
[`test/fixtures/README.md`](test/fixtures/README.md). The projection rules are
documented in [`docs/progress-contract.md`](docs/progress-contract.md).

## UI evidence

[`docs/evidence/`](docs/evidence/README.md) contains Orca-rendered screenshots
of the isolated DEMO scenarios: the six-top-level-worker page that prompted this
fix, the same page at 600 px and at 280 px, the two-level recorded graph, a
selected worker's full-width detail, missing/invalid parents, a cycle, three
branches, a deep chain, long text, 120 workers (truncation), the 关注事项 and
运行详情 sections, a finished run, no workers, stale, unavailable and corrupt.
It also captures the `UI_EVIDENCE` output from the real components-panel runtime
test that selects a worker, closes the detail from the header, opens and closes
运行详情, switches runs and presses refresh. The capture commands, the reversible
window minimize/restore, and the still-frame limits are documented there.

Known limitation on the tested Orca 1.4.248 macOS bundle: `orca plugin types .`
fails because the app bundle does not contain
`resources/plugins/declarative/*.d.ts` or `resources/plugins/types/*.d.ts`, so
`npx tsc -p .` cannot resolve the host `orca` module. This does not affect
`validate`, `test` or `check`; it is a packaging gap in that Orca build, not a
plugin build step.

## Limitations

- The panel is a projection of recorded facts. It cannot discover unrecorded
  nested workers, merges, tracker closures or offline workers.
- It does not verify acceptance or merge; coordinator-owned fields remain the
  authority.
- There is no polling; use the refresh button. A stale observation is not a
  failure, and a fresh observation is not proof of progress.
- The two-lane graph favours compactness in a narrow sidebar. A long recorded
  chain narrows inside its lane and a run with one top-level worker leaves the
  other lane empty; node identities and full task titles remain in the
  full-width detail.
- DEMO runs are demonstration data and must not be used as execution evidence.
