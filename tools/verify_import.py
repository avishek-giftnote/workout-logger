#!/usr/bin/env python3
"""
Verification harness for the Strong CSV importer.

This is NOT the production importer (that is the Java/Spring Boot code under backend/).
It is a runnable reference implementation of the SAME transform, used to PROVE the importer
logic against the real export before the Java code runs against MongoDB.

It mirrors DESIGN.md v4 §4-§5:
  - scope to the 4 templates
  - normalize U+202F before date parsing
  - parse all 4 duration shapes (#h #m / #h / #m / #s)
  - split Set Order into orderIndex + setType (W -> warmup)
  - bodyweight model: weight = cumulative effective load; loadMode/loadDelta preserved; estimated flag
  - reconstruct the 4 templates from the most-recent instance of each name
  - assert: 1,533 sets / 47 sessions / 30 exercises / 195 warmups / 61 bodyweight rows

Run:  python3 tools/verify_import.py [--bodyweight 75] [--csv strong_workouts.csv] [--dump out.json]
"""
import argparse, csv, json, re, sys, unicodedata
from collections import OrderedDict
from datetime import datetime

SCOPED_TEMPLATES = {
    "Anterior (Upper focus)", "Anterior (Lower focus)",
    "Posterior (Upper focus)", "Posterior (Lower focus)",
}
# Verbatim names (see DESIGN.md §4: shorthand "Knee Raise" has zero rows)
BODYWEIGHT_NAMES = {"Pull Up", "Knee Raise (Captain's Chair)"}

EXPECTED = dict(sets=1533, sessions=47, exercises=30, warmups=195, bodyweight_rows=61)


def normalize_ws(s: str) -> str:
    """Replace narrow/again non-breaking spaces (U+202F, U+00A0) with ASCII space."""
    return s.replace(" ", " ").replace(" ", " ") if s else s


def parse_started_at(raw: str) -> datetime:
    s = normalize_ws(raw).strip()
    # Strong: "2026-03-12 7:03:20 PM"  (12-hour, AM/PM)
    return datetime.strptime(s, "%Y-%m-%d %I:%M:%S %p")


_DUR = re.compile(r"^\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*$")


def parse_duration_seconds(raw: str):
    """Handle the 4 verified shapes: '#h #m', '#h', '#m', '#s'. Returns int seconds or None."""
    if not raw:
        return None
    m = _DUR.match(raw.strip())
    if not m or not any(m.groups()):
        raise ValueError(f"unparseable duration: {raw!r}")
    h, mi, se = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mi * 60 + se


def to_decimal_str(raw: str) -> str:
    """Keep weight as an exact decimal string (the wire/storage contract). Verbatim, no rounding."""
    return (raw or "").strip()


def build(rows, bodyweight_kg):
    """Transform scoped CSV rows -> session documents + exercise catalog + templates."""
    scoped = [r for r in rows if r["Workout Name"] in SCOPED_TEMPLATES]

    # Sessions keyed by the parsed instant alone (DESIGN §4 idempotency key).
    sessions = OrderedDict()
    catalog = OrderedDict()          # name -> {name, isBodyweight}
    warmups = 0
    bodyweight_rows = 0

    for idx, r in enumerate(scoped):
        started = parse_started_at(r["Date"])
        skey = started.isoformat()
        sess = sessions.get(skey)
        if sess is None:
            sess = sessions[skey] = dict(
                startedAt=skey, name=r["Workout Name"],
                durationSeconds=parse_duration_seconds(r["Duration"]),
                rawDurationText=r["Duration"], exercises=OrderedDict(),
            )

        name = unicodedata.normalize("NFC", r["Exercise Name"])
        is_bw = name in BODYWEIGHT_NAMES
        if name not in catalog:
            catalog[name] = dict(name=name, isBodyweight=is_bw)

        block = sess["exercises"].get(name)
        if block is None:
            block = sess["exercises"][name] = dict(
                name=name, position=len(sess["exercises"]), note=None, sets=[],
            )

        set_order = (r["Set Order"] or "").strip()
        set_type = "warmup" if set_order == "W" else "working"
        if set_type == "warmup":
            warmups += 1

        strong_weight = to_decimal_str(r["Weight"])
        sw = float(strong_weight or 0)

        if is_bw:
            bodyweight_rows += 1 if sw == 0 else 0
            # Strong's Weight column on a bodyweight exercise is the ADDED delta.
            load_delta = strong_weight                 # e.g. "0.0" or "10.0"
            load_mode = "bodyweight" if sw == 0 else "added"
            effective = f"{bodyweight_kg + sw:g}"       # cumulative effective load
            estimated = True                            # backfilled bodyweight (DESIGN §5)
        else:
            load_delta = None
            load_mode = None
            effective = strong_weight
            estimated = False

        block["sets"].append(dict(
            orderIndex=len(block["sets"]),
            setType=set_type,
            weight=effective,
            loadMode=load_mode,
            loadDelta=load_delta,
            weightUnit="kg",
            reps=int(float(r["Reps"])) if (r["Reps"] or "").strip() else None,
            rpe=int(float(r["RPE"])) if (r["RPE"] or "").strip() else None,
            note=(r["Notes"] or "").strip() or None,
            loggedAt=None,                  # no per-set time exists in the export
            estimated=estimated,
            importRowIndex=idx,
        ))

    # Reconstruct templates from the most-recent instance of each scoped name.
    latest_by_name = OrderedDict()
    for sess in sessions.values():
        latest_by_name[sess["name"]] = sess  # later sessions overwrite -> last wins (ordered by file)
    templates = []
    for tname in SCOPED_TEMPLATES:
        src = latest_by_name.get(tname)
        if src:
            templates.append(dict(
                name=tname,
                exercises=[dict(name=b["name"], position=b["position"])
                           for b in src["exercises"].values()],
            ))

    total_sets = sum(len(b["sets"]) for s in sessions.values() for b in s["exercises"].values())
    return dict(
        sessions=list(sessions.values()), catalog=list(catalog.values()),
        templates=templates,
        counts=dict(sets=total_sets, sessions=len(sessions), exercises=len(catalog),
                    warmups=warmups, bodyweight_rows=bodyweight_rows),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="strong_workouts.csv")
    ap.add_argument("--bodyweight", type=float, default=75.0,
                    help="current bodyweight kg used for effective-load backfill (counts are independent of it)")
    ap.add_argument("--dump", help="write the full transformed document tree to this JSON file")
    args = ap.parse_args()

    with open(args.csv, newline="") as f:
        rows = list(csv.DictReader(f))

    result = build(rows, args.bodyweight)
    counts = result["counts"]

    print("=== IMPORT VERIFICATION ===")
    ok = True
    for k, expected in EXPECTED.items():
        got = counts[k]
        flag = "OK " if got == expected else "FAIL"
        if got != expected:
            ok = False
        print(f"  [{flag}] {k:16} expected {expected:5}  got {got:5}")

    # Lossless spot-check: a weighted pull-up and a pure-bodyweight row round-trip correctly.
    print("\n--- bodyweight spot check (bodyweight={} kg) ---".format(args.bodyweight))
    for s in result["sessions"]:
        for b in s["exercises"].values():
            if b["name"] == "Pull Up":
                for st in b["sets"][:4]:
                    print(f"  Pull Up: mode={st['loadMode']:>10} delta={st['loadDelta']:>5} "
                          f"-> effective weight={st['weight']:>5} kg x {st['reps']} reps "
                          f"(estimated={st['estimated']})")
                break
        else:
            continue
        break

    print(f"\n  templates reconstructed: {[t['name'] for t in result['templates']]}")
    print(f"  exercises in catalog: {counts['exercises']}")

    if args.dump:
        with open(args.dump, "w") as out:
            json.dump(result, out, indent=2, ensure_ascii=False)
        print(f"\n  full document tree written to {args.dump}")

    print("\n" + ("ALL ASSERTIONS PASSED ✅" if ok else "ASSERTIONS FAILED ❌"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
