#!/usr/bin/env bash
# Rasterize public/icon.svg into the PNGs the manifest and iOS ask for.
#
# Run it after editing icon.svg; the PNGs are committed, so this is not part of any
# build. tests/client/manifest.test.ts only checks the files exist and are wired up —
# it cannot tell a stale PNG from a fresh one, so regenerating is on you.
#
# Rasterizer is macOS QuickLook, not ImageMagick: `magick`'s svg delegate shells out
# to rsvg-convert, which is not installed here, and its internal MSVG fallback is not
# something to trust with an app icon. `qlmanage` renders through WebKit, i.e. the
# same engine that will draw the SVG entry in the manifest.
#
# qlmanage always names its output "<input>.png" and only takes a single -s bound
# (the long edge), which is fine — icon.svg is square. Hence the render-then-rename.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=public/icon.svg
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }

# Lint before rendering, because qlmanage will not fail on a broken SVG: WebKit
# answers malformed XML with an *error page*, which QuickLook then rasterizes into a
# perfectly valid PNG of red error text. Every icon comes out looking like a
# screenshot of a stack trace and nothing exits non-zero. Observed for real — an
# XML comment cannot contain a double hyphen, and the one in icon.svg named CSS
# custom properties. xmllint ships with macOS.
xmllint --noout "$SRC" || { echo "$SRC is not well-formed — refusing to rasterize" >&2; exit 1; }

render() { # render <px> <dest>
  qlmanage -t -s "$1" -o public "$SRC" >/dev/null 2>&1
  mv "public/icon.svg.png" "public/$2"
  echo "  public/$2 ($1x$1)"
}

echo "rasterizing $SRC:"
render 512 icon-512.png
render 192 icon-192.png
# iOS reads this one via <link rel="apple-touch-icon"> and never the manifest, and it
# wants a PNG — a home screen icon is the one place an SVG is not accepted. 180 is the
# largest size iOS asks for; it downscales from there.
render 180 apple-touch-icon.png
