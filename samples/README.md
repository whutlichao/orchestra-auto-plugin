# Sample audit root

This directory is a self-contained, fabricated demo. It was generated with the
real orchestra-auto-zh `progress.py` recorder in `DEMO` mode; no real run data is
included. The `target_repo` fields were normalized to
`/tmp/orchestra-auto-demo-target` after generation.

| Directory | What it shows |
| --- | --- |
| `demo-active/` | Active DEMO run with accepted/running/blocked/waiting tasks, a lost worker, false/null delivery facts and a bookkeeping event. |
| `demo-finished/` | Completed DEMO run with verified delivery facts. |
| `demo-corrupt/` | Deliberately truncated JSON; the panel must show a corrupt state, not a success. |

## Try it

1. Open the **orchestra-auto** panel.
2. In Orca **Settings → Plugins → orchestra-auto**, set **本地审计目录** to the
   absolute path of this `audit-root` directory (one path per line).
3. Refresh the panel and select a run.

The panel labels DEMO runs and says the data is not execution or acceptance
evidence. The corrupt sample is expected to produce a "快照损坏" callout.

Real audit roots should be outside repositories and must not contain symlinks.
This directory is an intentional in-repository fixture for a read-only demo.
