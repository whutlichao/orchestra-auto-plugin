# orchestra-auto observatory

A read-only Orca sidebar panel for [orchestra-auto](https://github.com/whutlichao/orchestra-auto)
runs. It shows the run status, tasks, workers and delivery facts recorded in
`progress.json`, with an explicit state for missing, stale, corrupt and
unavailable data. It does not write run state, execute orchestration, control a
worker, or call Orca hooks.

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

Requires Orca `>=1.4.246`; tested on Orca `1.4.247` on macOS.

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

Discovery uses two sources:

1. **Registry descriptors** in `<registryHome>/runs/*.json`. The descriptor's
   `state_path` is accepted only if it is inside a configured audit root and has
   no symlink component.
2. **Audit roots**. If a root itself contains `progress.json`, it is one run;
   otherwise each direct child directory containing `progress.json` is a run.
   The scan is one level deep, not recursive.

The registry is optional. When discovery is configured, a run registered in
`~/.orca/progress` but whose state is outside every configured audit root appears
as unavailable and is never read.

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

- **Overview**: recorded run status, health, mode, phase, freshness, last
  observation and last effective progress, attention items, and a four-row
  delivery summary.
- **Tasks**: task IDs, titles, status, dependencies and blocked/pending notes.
- **Worker**: verified lifecycle, self-reported lifecycle, start confirmation,
  attempt, freshness, workspace basename and self-report summary. Self-report is
  not acceptance; `observed` and `unobserved` are not the same.
- **Delivery**: strict `true` / `false` / unverified for `implemented`,
  `integrated`, `merged` and `tracker_closed`; artifact labels only.
- **Events**: the most recent recorded events, with bookkeeping marked.

Missing, unknown and stale values are rendered as such. A missing delivery is
**unverified**, never success. A `completed` run status is shown as recorded
state, not as independent acceptance.

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
tasks/workers/deliveries, 100 rows per table, 100 projected attention records
(20 rendered), and 20 events. Counts remain complete, and truncation is shown
with the true total.

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

[`docs/evidence/`](docs/evidence/README.md) contains four Orca-rendered
screenshots of the isolated DEMO scenarios (ready, switched/finished,
unavailable, corrupt) and the captured `UI_EVIDENCE` output from the real
components-panel runtime test that switches runs and presses refresh. The
capture commands, the reversible window minimize/restore, and the still-frame
limits are documented there.

Known limitation on the tested Orca 1.4.247 macOS bundle: `orca plugin types .`
fails because the app bundle does not contain
`resources/plugins/{declarative,types}/*.d.ts`, so `npx tsc -p .` cannot run.
This does not affect `validate`, `test` or `check`; it is a packaging gap in
that Orca build, not a plugin build step.

## Limitations

- The panel is a projection of recorded facts. It cannot discover unrecorded
  nested workers, merges, tracker closures or offline workers.
- It does not verify acceptance or merge; coordinator-owned fields remain the
  authority.
- There is no polling; use the refresh button. A stale observation is not a
  failure, and a fresh observation is not proof of progress.
- DEMO runs are demonstration data and must not be used as execution evidence.
