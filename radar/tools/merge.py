"""레이더 살아 있는 목록 만들기 (2026-10-25 Benny: "새로 찾은 것만 쌓지 말고 기존 것과 조화롭게").

조사 세션은 그 회차에 찾은 것만 `radar/data/history/<주제>/<날짜>.json` 에 쓴다.
이 스크립트가 history 전체를 날짜 순으로 다시 읽어 `radar/data/<주제>.json` (페이지가 그리는 목록) 을 만든다.
상태(새로·상승·자리 잡음·식는 중·보관)는 모델이 아니라 여기서 규칙으로 정한다 → 매번 같은 결과.

  python -I radar/tools/merge.py ai            # 한 주제
  python -I radar/tools/merge.py all --latest C:/Users/1/Claude-Benny/agent-hub/radar/latest.md

오류가 있으면 아무것도 쓰지 않고 1 로 끝난다 (조사 세션이 고친 뒤 다시 돌림).
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent          # radar/
DATA = ROOT / "data"
HUB = pathlib.Path(r"C:\Users\1\Claude-Benny\agent-hub")

# 회차(주 2회) 기준 규칙
SETTLED_RUNS = 8      # 8회차(약 4주) 이상 보이면 자리 잡음
ARCHIVE_MISS = 6      # 6회차(약 3주) 연속 안 보이면 보관함
ARCHIVE_KEEP_DAYS = 120
TRAIL = 8

VERDICTS = {"", "진짜", "써 볼 만함", "지켜보기", "과장", "중요", "참고"}
VRANK = {"진짜": 0, "중요": 0, "써 볼 만함": 1, "지켜보기": 2, "참고": 3, "": 4, "과장": 5}
CHECKS = {"", "맞음", "부풀림", "확인 안 됨"}
MYPC = {"", "ok", "quant", "no"}
KEEP = ["category", "title", "url", "desc", "why", "verdict", "tags", "my_pc", "metric",
        "claim", "check", "check_note"]
LIMITS = {"title": 120, "desc": 140, "why": 400, "metric": 80, "claim": 200, "check_note": 200}


def load(p):
    return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))


def good_url(u):
    return isinstance(u, str) and re.match(r"^https?://[^\s]+$", u) is not None


def make_id(it):
    i = str(it.get("id") or "").strip().lower()
    if i:
        return i
    u = str(it.get("url") or "").lower()
    m = re.match(r"https?://github\.com/([^/]+/[^/#?]+)", u)
    if m:
        return "github:" + m.group(1)
    m = re.match(r"https?://huggingface\.co/(spaces/|datasets/|papers/)?([^#?]+)", u)
    if m:
        return "hf:" + (m.group(1) or "") + m.group(2).rstrip("/")
    return re.sub(r"\W+", "-", str(it.get("title", "")).lower()).strip("-")


def check_run(run, topic, cats, path, errs, warns):
    where = path.name
    if run.get("topic") != topic:
        errs.append(f"{where}: topic 이 '{topic}' 아님")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(run.get("date", ""))) or run.get("date") != path.stem:
        errs.append(f"{where}: date 가 파일 이름과 다름")
    found = run.get("found")
    if not isinstance(found, list) or not found:
        errs.append(f"{where}: found 가 비었음")
        return
    for n, it in enumerate(found):
        tag = f"{where} found[{n}]"
        if not it.get("title") or not good_url(it.get("url")):
            errs.append(f"{tag}: title·url(http) 필요")
        if it.get("category") not in cats:
            warns.append(f"{tag}: 분류 '{it.get('category')}' 없음 → 기타")
            it["category"] = "기타"
        if it.get("verdict", "") not in VERDICTS:
            errs.append(f"{tag}: verdict '{it.get('verdict')}' 는 {sorted(VERDICTS - {''})} 중 하나")
        if it.get("check", "") not in CHECKS:
            errs.append(f"{tag}: check 는 맞음/부풀림/확인 안 됨")
        if it.get("my_pc", "") not in MYPC:
            errs.append(f"{tag}: my_pc 는 ok/quant/no")
        for k, lim in LIMITS.items():
            v = it.get(k)
            if isinstance(v, str) and len(v) > lim:
                warns.append(f"{tag}: {k} {len(v)}자 → {lim}자로 자름")
                it[k] = v[:lim - 1] + "…"
    for s in run.get("shorts") or []:
        if not good_url(s.get("url")):
            errs.append(f"{where} shorts: url 필요 ({s.get('title', '')[:30]})")
        if s.get("check", "") not in CHECKS:
            errs.append(f"{where} shorts: check 는 맞음/부풀림/확인 안 됨")
    t = run.get("try") or {}
    if t and t.get("url") and not good_url(t["url"]):
        errs.append(f"{where} try: url 이상")


def status_at(seen, last):
    """seen = 보인 회차 번호들, last = 마지막 회차 번호."""
    if not seen:
        return None
    if last in seen:
        if len(seen) == 1:
            return "new"
        if (last - 1) not in seen:
            return "back"
        return "settled" if len(seen) >= SETTLED_RUNS else "rising"
    miss = last - max(seen)
    return "archived" if miss >= ARCHIVE_MISS else "cooling"


def build(topic, cfg, tried):
    cats = cfg["categories"]
    files = sorted((DATA / "history" / topic).glob("*.json"))
    errs, warns = [], []
    runs = []
    for p in files:
        try:
            r = load(p)
        except Exception as e:
            errs.append(f"{p.name}: JSON 오류 {e}")
            continue
        check_run(r, topic, cats, p, errs, warns)
        runs.append(r)
    if errs or not runs:
        return None, errs or [f"{topic}: history 가 없음"], warns

    items = {}
    for n, r in enumerate(runs):
        for it in r["found"]:
            i = make_id(it)
            cur = items.setdefault(i, {"id": i, "first_seen": r["date"], "seen": [], "trail": []})
            for k in KEEP:
                if it.get(k) not in (None, "", []):
                    cur[k] = it[k]
            if n not in cur["seen"]:
                cur["seen"].append(n)
                cur["trail"] = (cur["trail"] + [{"d": r["date"], "m": it.get("metric", "")}])[-TRAIL:]
            cur["last_seen"] = r["date"]

    last = len(runs) - 1
    today = dt.date.fromisoformat(runs[-1]["date"])
    active, archive, changes = [], [], []
    rank = {"new": 0, "back": 1, "rising": 2, "settled": 3, "cooling": 4}
    for it in items.values():
        st = status_at(it["seen"], last)
        before = status_at([s for s in it["seen"] if s < last], last - 1) if last else None
        it["status"], it["count"] = st, len(it["seen"])
        it["tried"] = it["id"] in tried
        seen = it.pop("seen")
        if st in ("new", "back") or (st == "settled" and before != "settled") or (st == "archived" and before != "archived"):
            changes.append({"id": it["id"], "title": it.get("title", ""), "url": it.get("url", ""),
                            "category": it.get("category", "기타"), "change": st})
        if st == "archived":
            if (today - dt.date.fromisoformat(it["last_seen"])).days <= ARCHIVE_KEEP_DAYS:
                archive.append(it)
        else:
            it["_r"] = (rank[st], VRANK.get(it.get("verdict", ""), 4), -len(seen), it.get("title", ""))
            active.append(it)
    active.sort(key=lambda x: x.pop("_r"))
    archive.sort(key=lambda x: x["last_seen"], reverse=True)
    corder = {c: k for k, c in enumerate(cats + ["기타"])}
    changes.sort(key=lambda c: (["new", "back", "settled", "archived"].index(c["change"]), corder.get(c["category"], 99)))

    r = runs[-1]
    out = {
        "topic": topic, "updated": r["date"], "generated": r.get("generated", ""), "runs": len(runs),
        "headline": r.get("headline", ""), "try": r.get("try") or {}, "shorts": r.get("shorts") or [],
        "notes": r.get("notes", ""), "categories": cats, "changes": changes,
        "items": active, "archive": archive,
    }
    return out, [], warns


def guard(texts):
    """agent-hub 의 회사 단어 검사 (있을 때만). 걸리면 단어 번호만 알린다."""
    try:
        sys.path.insert(0, str(HUB))
        import hub  # noqa
        words = hub.guard_words()
    except Exception:
        return []
    hits = []
    for name, t in texts.items():
        for i, w in enumerate(words):
            if w.search(t):
                hits.append(f"{name}: 회사 단어#{i} 걸림 — 그 항목을 빼거나 일반 표현으로")
    return hits


STLABEL = {"new": "🆕", "back": "↩", "rising": "🔥", "settled": "📌", "cooling": "💤"}


def latest_md(cfgs, order):
    lines = ["# 레이더 요약 (자동 생성 — 손으로 고치지 말 것)", "전체: https://benny3s.github.io/radar/", ""]
    for t in order:
        p = DATA / f"{t}.json"
        if not p.exists():
            continue
        d = load(p)
        lines.append(f"## {cfgs[t]['name']} ({d['updated']}) — {d.get('headline', '')}")
        ch = [c for c in d["changes"] if c["change"] in ("new", "back", "settled")][:6]
        if ch:
            lines.append("바뀐 것: " + " · ".join(f"{STLABEL.get(c['change'], '')}{c['title']}" for c in ch))
        top = [i for i in d["items"] if i["status"] in ("settled", "rising", "new")][:6]
        for i in top:
            lines.append(f"- {STLABEL.get(i['status'], '')} {i.get('title', '')} — {i.get('desc', '')} {i.get('url', '')}")
        if d.get("try", {}).get("title"):
            lines.append(f"{cfgs[t].get('try_label', '해 볼 것')}: {d['try']['title']} {d['try'].get('url', '')}")
        lines.append("")
    return "\n".join(lines)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("topic", help="주제 id 또는 all")
    ap.add_argument("--latest", help="세션용 요약 md 를 여기 씀")
    a = ap.parse_args()
    conf = load(ROOT / "topics.json")
    cfgs, order = conf["topics"], conf["order"]
    want = order if a.topic == "all" else [a.topic]
    if any(t not in cfgs for t in want):
        sys.exit(f"모르는 주제: {a.topic} (있는 것: {', '.join(order)})")
    tried_p = ROOT / "tried.json"
    tried_all = load(tried_p) if tried_p.exists() else {}

    outs, errs, warns = {}, [], []
    for t in want:
        if not (DATA / "history" / t).exists():
            if a.topic != "all":
                errs.append(f"{t}: history 폴더 없음")
            continue
        o, e, w = build(t, cfgs[t], set(tried_all.get(t, [])))
        errs += e
        warns += w
        if o:
            outs[t] = o
    texts = {f"{t}.json": json.dumps(o, ensure_ascii=False) for t, o in outs.items()}
    errs += guard(texts)
    for w in warns:
        print("주의:", w)
    if errs:
        for e in errs:
            print("오류:", e)
        sys.exit(1)
    for t, o in outs.items():
        (DATA / f"{t}.json").write_text(json.dumps(o, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{t}: 회차 {o['runs']} · 목록 {len(o['items'])} · 보관 {len(o['archive'])} · 바뀐 것 {len(o['changes'])}")
    if a.latest:
        md = latest_md(cfgs, order)
        hit = guard({"latest.md": md})
        if hit:
            for h in hit:
                print("오류:", h)
            sys.exit(1)
        pathlib.Path(a.latest).write_text(md, encoding="utf-8", newline="\n")
        print("요약:", a.latest)


if __name__ == "__main__":
    main()
