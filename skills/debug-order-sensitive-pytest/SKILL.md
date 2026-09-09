---
name: debug-order-sensitive-pytest
description: "Debug and fix pytest tests that pass alone but fail when the suite runs in a different order. Use when: (1) tests are flaky under shuffled/randomized order, (2) a failing test passes in isolation but fails in the full suite, or (3) tests leak global state (sys.modules, module reloads, shared singletons, env vars) across tests."
---

# Debug Order-Sensitive Pytest Failures

Find and fix tests that pass on their own but fail when pytest runs in a different order. The suite is green again only after every leaked-global-state polluter is fixed and both the shuffled and the normal runs pass.

## Quick quality checklist

- Repro order is pinned with a fixed seed and printed so any failure is reproducible
- Always bisect with the failing target test **appended** to every slice (a failing window can contain multiple polluters)
- Instrumented runs are only hints — always confirm on clean runs
- No private data, paths, or project-specific test names in this skill

## When to use

- A test fails only in the full suite but passes standalone with `pytest <file>` or `pytest <nodeid>`
- A CI job that randomizes test order (pytest-randomly, custom shuffle) is flaky
- You suspect a test mutates `sys.modules`, reloads a module, or mutates a shared module-level singleton without restoring it

## Required tools / APIs

- Python 3.8+ and pytest (no external API)
- Optional: a shuffling runner (pytest-randomly, or a local seeded-shuffle plugin, described below)

## Steps

### 1. Reproduce with a fixed-seed shuffle

Pin the order so every bisection uses the exact same failing sequence. Use pytest-randomly:

```bash
pip install pytest-randomly
python -m pytest -q --randomly-seed=42 -p no:cacheprovider --tb=no | tee order.log
```

Or, for a repo that already has a seeded-shuffle runner (e.g. `tests/run_order_report.py --seed 42`), use it. If neither exists, add a tiny local plugin that shuffles collection with a fixed seed:

```python
# shuffle42.py  (load with: python -m pytest -p shuffle42 ...)
import random

def pytest_collection_modifyitems(items):
    random.Random(42).shuffle(items)
```

Record the failing nodeids from the log. The seed must be printed/stored so the order is reproducible.

### 2. Dump the shuffled order to a file

Every bisection slice must come from the **same shuffled order**. The shuffle must be re-applied deterministically to the same collected list, so dump the exact order once:

```bash
python -m pytest --collect-only -q 2>/dev/null | grep "::" > collected.txt
python - <<'PY'
import random
ids = [l.strip() for l in open("collected.txt") if l.strip() and "::" in l]
random.Random(42).shuffle(ids)
open("shuffled.txt", "w").write("\n".join(ids) + "\n")
PY
```

Now the order in `shuffled.txt` is exactly the order pytest-randomly/your plugin ran, and every slice is reproducible.

### 3. Bisect with ordered windows (target test always appended)

A failing region can hold **several independent polluters**, so a window and its bisected halves can each pass while the full window fails. The fix: run exact windows and always **append the failing target test** to the slice, so the target is what you observe.

```python
# run_slice.py -- run a window of shuffled.txt, always appending the target test
import random, sys
from pathlib import Path
ids = [l.strip() for l in Path("shuffled.txt").read_text().splitlines() if l.strip()]
random.Random(42).shuffle(ids)

class OrderPlugin:
    def __init__(self, order):
        self.order = order
    def pytest_collection_modifyitems(self, items):
        by_id = {i.nodeid: i for i in items}
        items[:] = [by_id[n] for n in self.order if n in by_id]

def main():
    import pytest
    start, end = int(sys.argv[1]), int(sys.argv[2])
    window = ids[start:end]
    target = sys.argv[3]
    for nodeid in ids:
        if nodeid == target and nodeid not in window:
            window.append(nodeid)
    return pytest.main(["-q", "-p", "no:cacheprovider", "--tb=short"],
                       plugins=[OrderPlugin(window)])

main()
```

Usage:

```bash
python run_slice.py 0 1000 'tests/test_thing.py::test_target'   # window + target appended
python run_slice.py 0 500  'tests/test_thing.py::test_target'   # left half still fails?
python run_slice.py 500 1000 'tests/test_thing.py::test_target' # right half still fails?
```

A slice that passes with the target removed but fails with it present means the polluter is inside that window. Halve repeatedly. If both halves pass but the combined window fails, a two-test interaction is at play: keep widening one boundary to find the second polluter.

### 4. Check the common leak patterns

Once a polluting test is isolated, look for these state leaks and fix them at the source:

- **`sys.modules.pop(name)` without restore** — any later test doing `monkeypatch.setattr("pkg.mod.X", ...)` triggers a *fresh import* whose module object differs from the one collected tests captured. Fix: snapshot `{name: sys.modules.get(name) for name in (...)}` before, and restore the same object in a `finally` (leave absent if it was absent).
- **`importlib.reload(mod)`** — reload re-executes code in the *same* module `__dict__` in place; names like module-level caches get **rebound to new objects**, so module attributes captured earlier by `from mod import CACHE` become stale (`.clear()` clears an orphan). Fix: snapshot the module `__dict__` (and env vars) before, restore them after — restoring `sys.modules` entries is not enough.
- **Shared module-level singletons** — a module-level `APIRouter`, cache dict, registry, or DB engine that tests mutate and never restore. Fix: `monkeypatch.setattr` for restorable mutations, or a fixture that snapshots/restores; never leave a test-only registration behind.
- **`monkeypatch.setattr("pkg.mod.fn", ...)` vs `from pkg.mod import fn`** — the patch lands on the module attribute; a pre-imported `fn` reference still points at the original. Patch what the code under test actually calls.

### 5. Instrument to confirm (then verify clean)

To find *which* test mutates a module, add a read-only hook that records module/attribute identity after every test. Note that pytest calls later-registered plugins first: a plugin's `pytest_runtest_teardown` fires **before** core fixture teardown. To observe post-teardown (post-restore) state, use the report hook:

```python
class StateTrack:
    def __init__(self):
        self.orig = None
    def pytest_sessionstart(self, session):
        import pkg.mod
        self.orig = sys.modules.get("pkg.mod")
    def pytest_runtest_makereport(self, item, call):
        if call.when != "teardown" or call.excinfo is not None:
            return
        mod = sys.modules.get("pkg.mod")
        if mod is not self.orig:
            print(f"CHANGED after {item.nodeid}: {id(mod) if mod else 'ABSENT'}")
```

The trace shows exactly which test evicts/replaces the module. **Warning:** instrumented runs can change timing/state and diverge from the real suite — always confirm a fix with clean (uninstrumented) runs.

### 6. Verify

```bash
# shuffled suite, same seed as step 1 — must exit 0
python -m pytest -q --randomly-seed=42 -p no:cacheprovider --tb=no

# normal (unshuffled) suite — must still exit 0
python -m pytest -q -p no:cacheprovider --tb=no

# the previously flaky file standalone — must pass
python -m pytest tests/test_thing.py -q -p no:cacheprovider --tb=no
```

## Output format

Report for each fixed polluter:

- Polluting test nodeid + position in the shuffled order
- The leak mechanism (one of: sys.modules pop/replace, in-place module reload, shared singleton, stale import reference)
- The fix (what was snapshotted/restored or monkeypatched)
- Final verification: shuffled suite exit code + normal suite exit code

## Troubleshooting

**Symptom: the failing window passes now but a full run still fails.**
- A region can contain multiple polluters. Re-dump the failing nodeids from the latest full run and re-bisect each one with the target appended.

**Symptom: instrumented run shows thousands of errors / diverges.**
- The instrumentation itself disturbs state. Drop it and bisect with the plain window runner instead; use the instrument only to confirm a suspected mechanism, never as the source of truth.

**Symptom: same window fails sometimes, passes other times.**
- If both runners shuffle the same file with the same seed, the order is identical — double-check that both used the same list (extra/duplicate lines in the ids file change the shuffle). Verify the shuffled ids file matches the actual run order before trusting any slice.

**Symptom: `pytest_runtest_teardown` shows state already restored.**
- Your hook runs before core fixture teardown. Use `pytest_runtest_makereport` with `call.when == "teardown"` and `call.excinfo is None` to observe post-restore state.

## See also

- [../pytest-isolation-conventions/SKILL.md](../pytest-isolation-conventions/SKILL.md) — Coding conventions that prevent this class of bug (if added)

