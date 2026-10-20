"""Verify shipped TP Rounded fonts.

usage: python3 -I verify.py <dir-or-font> [...]

Fails (exit 1) when any font:
- still has a `locl` or `aalt` GSUB/GPOS feature;
- shapes 户, 令 or a digit to anything other than its nominal cmap glyph (HarfBuzz, scripts hani/latn,
  languages zh-Hans/ja/none) — this is what the upstream locl did;
- carries the upstream font names (font-name records or CFF names) instead of TP Rounded.
Also fails when one of the probe characters is not shipped at all. Run it on an upstream OTF to see it
report the Japanese substitutions.
"""
import io
import pathlib
import sys

import uharfbuzz as hb
from fontTools.ttLib import TTFont

BANNED_FEATURES = {"locl", "aalt"}
PROBE = "户令0123456789"
BANNED_NAMES = ("chill", "寒蝉", "寒蟬", "source")
FONT_NAME_IDS = {1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}
SHAPES = [("hani", "zh-Hans"), ("hani", "ja"), ("hani", None), ("latn", "zh-Hans"), ("latn", None)]


def font_files(args):
    for a in args:
        p = pathlib.Path(a)
        if p.is_dir():
            yield from sorted(p.glob("*.woff2"))
        else:
            yield p


def check(path, problems, shipped):
    f = TTFont(str(path))
    for table in ("GSUB", "GPOS"):
        if table in f and f[table].table.FeatureList:
            tags = {fr.FeatureTag for fr in f[table].table.FeatureList.FeatureRecord}
            if tags & BANNED_FEATURES:
                problems.append(f"{path.name}: {table} has {sorted(tags & BANNED_FEATURES)}")
    names = [r.toUnicode() for r in f["name"].names if r.nameID in FONT_NAME_IDS]
    if "CFF " in f:
        cff = f["CFF "].cff
        top = cff.topDictIndex[0]
        names += list(cff.fontNames) + [getattr(top, "FullName", ""), getattr(top, "FamilyName", "")]
        names += [getattr(fd, "FontName", "") for fd in getattr(top, "FDArray", [])]
    for n in names:
        if any(b in n.lower() for b in BANNED_NAMES):
            problems.append(f"{path.name}: upstream name survives: {n!r}")

    cmap = f.getBestCmap()
    present = [c for c in PROBE if ord(c) in cmap]
    if not present:
        return
    expected = {c: f.getGlyphID(cmap[ord(c)]) for c in present}
    buf = io.BytesIO()
    f.flavor = None
    f.save(buf)
    hb_font = hb.Font(hb.Face(buf.getvalue()))
    for script, lang in SHAPES:
        b = hb.Buffer()
        b.add_str("".join(present))
        b.direction = "ltr"
        b.script = script
        if lang:
            b.language = lang
        hb.shape(hb_font, b, {})
        got = [g.codepoint for g in b.glyph_infos]
        want = [expected[c] for c in present]
        if got != want:
            problems.append(f"{path.name}: {script}/{lang or '-'} shapes {''.join(present)} to {got}, nominal {want}")
    for c in present:
        shipped.setdefault(c, []).append(path.name)


def main(args):
    problems, shipped = [], {}
    files = list(font_files(args))
    for p in files:
        check(p, problems, shipped)
    missing = [c for c in PROBE if c not in shipped]
    if missing:
        problems.append(f"probe characters not shipped: {''.join(missing)}")
    for p in problems:
        print("FAIL", p)
    status = "ok" if not problems else f"{len(problems)} problem(s)"
    print(f"verify: {len(files)} font(s), probe {PROBE} shaped nominal in {len(SHAPES)} script/language pairs -> {status}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
