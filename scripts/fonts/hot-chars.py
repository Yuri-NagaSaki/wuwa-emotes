"""Write scripts/fonts/hot-chars.txt: the site's display vocabulary, most frequent first.

usage: python3 -I scripts/fonts/hot-chars.py <repo-root> > scripts/fonts/hot-chars.txt

Sources: pack titles (weight 3), character names (2) and artists (1) from the catalog snapshot in
design/prototype/data.js (generated from R2 meta/v1), plus the UI copy of the prototype pages.
build.ts puts these characters into the first, small shards (40 per shard), so a typical page needs a
few small files instead of one 30 KB shard per uncommon character. Regenerate from the live catalog when
it has drifted far from the snapshot; any character not listed still ships, in the later shards.
"""
import collections
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
src = (root / "design/prototype/data.js").read_text("utf-8")
data = json.loads(src[src.index("{") : src.rindex("}") + 1])
cjk = re.compile(r"[　-〿぀-ヿ㐀-鿿＀-￯]")
freq = collections.Counter()
for p in data["packs"]:
    freq.update(cjk.findall(p["title"]) * 3)
    for c in p.get("chars") or []:
        freq.update(cjk.findall(c) * 2)
    for a in p.get("artists") or []:
        freq.update(cjk.findall(a))
for c in data.get("characters") or []:
    name = c["name"] if isinstance(c, dict) else c
    freq.update(cjk.findall(name) * 2)
ui = "".join((root / "design/prototype/src" / f).read_text("utf-8") for f in ("pages-public.js", "ui.js", "pages-admin.js"))
freq.update(cjk.findall(ui))
print("".join(c for c, _ in freq.most_common()))
