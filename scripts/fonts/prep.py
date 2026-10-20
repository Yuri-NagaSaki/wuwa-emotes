"""Prepare one TP Rounded weight from a ChillRoundGothic OTF: subset, drop locl/aalt, rename.

usage: python3 -I prep.py <src.otf> <out.otf> <charset.txt> <style>

- Layout features use an explicit allow-list: what browsers apply to horizontal text by default (ccmp,
  liga, kern) and halt, which Chrome's text-spacing-trim uses to collapse adjacent CJK punctuation.
  `locl` is left out on purpose: upstream registers it for DFLT and ZHS and swaps 户, 令 and the digits
  for Japanese forms in every language. `aalt` only lists alternates and would pull every alternate glyph
  into the subset. The site never turns on the others (frac, sups, ordn, palt, fwid, hwid, pwid, and the
  vertical vert, vhal, vpal); their alternate glyphs only made the shards larger (the ASCII shard by
  about a third).
- The upstream copyright (name ID 0) declares the Reserved Font Names 'Source' and 'ChillRounded', so the
  modified font is published as "TP Rounded": every font-name record and the CFF names are rewritten.
  Copyright (0), designer/vendor credits and the license records (13, 14) are kept.
"""
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

FAMILY = "TP Rounded"
PS_FAMILY = "TPRounded"
FEATURES = ["ccmp", "liga", "kern", "halt"]
FONT_NAME_IDS = {1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}


def read_unicodes(path):
    with open(path, encoding="utf-8") as f:
        return sorted({ord(c) for c in f.read()})


def subset_font(font, unicodes):
    opts = subset.Options()
    opts.layout_features = FEATURES
    opts.layout_scripts = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.name_legacy = True
    opts.hinting = False
    opts.desubroutinize = True
    opts.notdef_outline = True
    opts.glyph_names = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)


def rename(font, style):
    full = f"{FAMILY} {style}"
    ps = f"{PS_FAMILY}-{style}"
    name = font["name"]
    # 10 (description) names the upstream families and 19 is a sample text; both are rewritten/dropped.
    name.names = [r for r in name.names if r.nameID not in FONT_NAME_IDS | {10, 19}]
    version = font["head"].fontRevision
    values = {
        1: full,
        2: "Regular",
        3: f"{version:.3f};{ps}",
        4: full,
        6: ps,
        10: "Modified, renamed subset of ChillRoundGothic v3.750 (SIL OFL 1.1).",
        16: FAMILY,
        17: style,
    }
    for nid, value in values.items():
        name.setName(value, nid, 3, 1, 0x409)

    cff = font["CFF "].cff
    old = cff.fontNames[0]
    top = cff.topDictIndex[0]
    cff.fontNames = [ps]
    top.FullName = full
    top.FamilyName = FAMILY
    if hasattr(top, "FDArray"):
        for fd in top.FDArray:
            fd_name = getattr(fd, "FontName", None)
            if fd_name:
                fd.FontName = fd_name.replace(old, ps)


def main(src, out, charset_path, style):
    # keep the upstream head.modified so a rebuild produces byte-identical files
    font = TTFont(src, recalcTimestamp=False)
    subset_font(font, read_unicodes(charset_path))
    rename(font, style)
    font.flavor = None
    font.save(out)
    tags = sorted({fr.FeatureTag for fr in font["GSUB"].table.FeatureList.FeatureRecord})
    print(f"prep {style}: {len(font.getBestCmap())} chars, {font['maxp'].numGlyphs} glyphs, GSUB {tags} -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:5])
