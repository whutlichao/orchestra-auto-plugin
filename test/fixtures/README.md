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

## Reproduce

From a checkout of `orchestra-auto`:

```sh
PROGRESS=/path/to/orchestra-auto/skills/orchestra-auto-zh/scripts/progress.py
BASE=$(python3 -c 'import os,tempfile; print(os.path.realpath(tempfile.mkdtemp(prefix="orca-plugin-fixtures-")))')
mkdir -p "$BASE/target"
python3 "$PROGRESS" --state "$BASE/state-active" --json init --event-id init-1 --effective \
  --data "{\"id\":\"fixture-active\",\"target_repo\":\"$BASE/target\",\"mode\":\"REAL\",\"phase\":\"implementation\",\"status\":\"active\",\"title\":\"Fixture: active run\"}"
# ... task/worker/event/delivery/artifact calls as recorded in src/contract.test.ts
cp "$BASE/state-active/progress.json" test/fixtures/real-active/progress.json
```

Use a state directory outside every repository. The tests read these files at
runtime with `orca plugin test .`.
