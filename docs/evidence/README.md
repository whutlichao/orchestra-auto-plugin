# UI evidence

This directory contains UI evidence for the read-only observatory panel. All
data is the isolated `DEMO` sample; no real run, audit path or credential is
shown.

## Rendered screenshots

Captured on 2026-11-03 with Orca 1.4.247 on macOS, panel width 336 px, current
(dark) theme. The Orca window was minimized for the capture and restored
immediately afterwards. The plugin was **not** loaded into the sidebar, enabled,
or approved.

```sh
# window minimized via the accessibility tree; restored after the captures
orca plugin shot . --scenario ready       --out /tmp/orca-ui2-ready.png --json
orca plugin shot . --scenario finished    --out /tmp/orca-ui2-finished.png --json
orca plugin shot . --scenario unavailable --out /tmp/orca-ui2-unavailable.png --json
orca plugin shot . --scenario corrupt     --out /tmp/orca-ui2-corrupt.png --json
```

`--scenario` runs the panel and worker against a stand-in host and draws the
resulting tree in Orca's window; it does not open the plugin's sidebar or
approve it. `--json` reported `ok: true`, `settled: true`, `errors: []` and
`replay: true` for all four captures.

| File | Shows |
| --- | --- |
| `orca-ui-ready.png` | Active DEMO run: selector, status/health/freshness badges, DEMO and health warnings, attention list, delivery facts. |
| `orca-ui-finished.png` | Finished DEMO run: completed status, healthy/current badges, empty attention, delivery facts, collapsed recent-events section. The interaction test switches to this same run in the real runtime. |
| `orca-ui-unavailable.png` | Missing state: unavailable badge, "运行不可用", `progress.json` missing/unreadable message, retry control. |
| `orca-ui-corrupt.png` | Corrupt snapshot: "快照损坏", invalid-JSON message, retry control. |
| `orca-ui-ready-before-fix.png` | The first capture, before the UI fix: the delivery summary column was squeezed to unreadable glyphs and the fifth tab overflowed the 336 px sidebar. |

The first capture exposed two real narrow-sidebar defects: the delivery summary
table's first column was compressed by the three numeric columns, and the five
tabs overflowed the sidebar. The fix uses a `KeyValue` delivery summary (so all
four facts and counts are readable) and four tabs with the events moved into a
collapsed section in the Overview. The `before-fix` image is kept for comparison.

## Interaction evidence

`orca plugin shot --scenario` is a still frame and does not accept `--act`.
Driving the live panel with `--act` would require loading/approving the plugin,
which is out of scope here. The real controls are instead exercised in Orca's
own components-panel runtime by `src/panel.evidence.test.tsx`:

- select the second run (`demo-active` -> `demo-finished`);
- press the refresh control and assert a second `runs.list`;
- mount the unavailable and corrupt scenarios and assert their error callouts.

`orca plugin test .` prints the rendered summaries as `UI_EVIDENCE ...` lines;
the captured output is in `ui-interaction-evidence.txt`. The same suite reports
33/33 passing tests.

## Limits

- The screenshots are still frames of scenario renders, not live side-by-side
  animations of a click. The interaction sequence is covered by the component
  runtime test above.
- Orca's window must be minimized or hidden for a scenario shot. The capture
  used a reversible minimize/restore via the macOS accessibility API; the
  window's prior state was restored.
- The screenshots show the current dark theme; no `--theme` override was used.
