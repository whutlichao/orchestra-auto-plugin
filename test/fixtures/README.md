# Recorder fixtures

These `progress.json` files were produced by the real orchestra-auto-zh
`scripts/progress.py` (protocol v2, schema version 2), not hand-written.

- `real-active/progress.json`: five tasks, three workers, two delivery records,
  one artifact, a bookkeeping event and a self-reported completion.
- `real-finished/progress.json`: one task, one worker, a completed run and all
  four delivery facts true.

The data is fabricated for tests. After generation, only `run.target_repo` was
normalized to `/tmp/orchestra-auto-fixture-target`; every other field and the
formatting come from the recorder. No real audit state, credentials, messages or
terminal content is stored here.

## Provenance

The fixtures were generated on 2026-11-03 with the recorder's protocol-v2 write
commands (init, task, worker, event, delivery, artifact and end), using
fabricated data and a temporary target/state directory outside every repository.
The committed files are the source the tests read; no generation step runs in
the test suite.
