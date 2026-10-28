"""메인 페이지 기본 문구(index.html 의 DEFAULT_ITEMS)를 서버에 저장된 문구(portal/config)와 맞춘다.

관리자 모드에서 고친 문구는 Firestore portal/config 에 저장되고, 코드의 기본 문구는 그대로 남는다.
기본 문구는 처음 오는 사람이 서버에 못 닿을 때만 쓰이지만, 둘이 다르면 헷갈리니 GitHub Actions 가
하루 한 번(또는 버튼으로) 이 스크립트를 돌려 맞춘다 (2026-10-10 Benny).

- portal/config 는 누구나 읽을 수 있어서 비밀번호·열쇠가 필요 없다 (REST, apiKey 없이)
- 바뀐 게 있을 때만 index.html 을 고친다 → 워크플로가 그때만 커밋
- 끝나면 "changed" / "same" 을 출력
"""
import json
import pathlib
import re
import sys
import urllib.request

# 공개 문서라 apiKey 없이 읽힘 — 웹 키는 사이트 주소(referrer) 제한이 걸려 있어 Actions 에서 쓰면 거절됨 (2026-10-28)
URL = ("https://firestore.googleapis.com/v1/projects/benny-meeting/databases/(default)"
       "/documents/portal/config")
START = "/* DEFAULT_ITEMS:START — 아래 목록은 tools/sync_portal_defaults.py 가 서버 문구로 자동으로 맞춘다 */"
END = "/* DEFAULT_ITEMS:END */"
KEYS = ["id", "emoji", "name", "desc", "url", "hidden"]


def js_item(it):
    parts = []
    for k in KEYS + [k for k in it if k not in KEYS]:
        if k not in it:
            continue
        v = it[k]
        parts.append(k + ": " + ("true" if v is True else "false" if v is False else json.dumps(v, ensure_ascii=False)))
    return "  { " + ", ".join(parts) + " }"


def main():
    with urllib.request.urlopen(URL, timeout=20) as r:
        doc = json.load(r)
    items = json.loads(doc["fields"]["json"]["stringValue"])["items"]
    if not isinstance(items, list) or not items:
        print("서버 목록이 비어 있어서 그대로 둠")
        return "same"

    p = pathlib.Path(__file__).resolve().parent.parent / "index.html"
    html = p.read_text(encoding="utf-8")
    m = re.search(re.escape(START) + r"\n(.*?)\n" + re.escape(END), html, re.S)
    if not m:
        sys.exit("index.html 에 DEFAULT_ITEMS 표시(START/END)가 없음")

    # 코드에만 있는 새 항목(아직 관리자 모드로 저장 안 한 것)은 지우지 않고 뒤에 남긴다 (2026-10-24 AI 레이더)
    ids = {it.get("id") for it in items}
    lines = [js_item(it) for it in items]
    for line in m.group(1).splitlines():
        mm = re.match(r'\s*\{ id: "([^"]+)"', line)
        if mm and mm.group(1) not in ids:
            lines.append(line.rstrip().rstrip(","))
    block = "const DEFAULT_ITEMS = [\n" + ",\n".join(lines) + "\n];"
    if m.group(1) == block:
        print("same")
        return "same"
    p.write_text(html[:m.start(1)] + block + html[m.end(1):], encoding="utf-8", newline="\n")
    print("changed")
    return "changed"


if __name__ == "__main__":
    main()
