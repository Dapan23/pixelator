# Pixelator

A tiny, dependency-free web app that turns a photo into a clean pixelated
image. Pixelation is the only required transformation — no color filters or
palettes. An optional retro dithering texture is available but off by
default.

## How it works

1. Load a photo (file picker, drag-and-drop, or paste).
2. Drag the **Pixel size** slider (1–32px per block, default 4). Each
   block's color is the exact average of its source pixels, drawn back at
   full size with hard, nearest-neighbor edges — no blur, no soft edges.
3. Optionally enable **Dither texture** for a retro ordered-dithering look,
   with adjustable color count and dither strength.
4. Click **Download PNG** to save the result.

Colors are left exactly as sampled from the original photo — nothing is
recolored or mapped to a palette unless dithering is explicitly enabled.

## Usage

- **Load an image**: click the drop zone to browse, drag a file onto it, or
  paste (Ctrl+V / Cmd+V) an image from your clipboard.
- **Adjust pixel size**: drag the slider for a live preview.
- **Dither texture**: toggle on for a retro dot-grid look, then tune
  "Number of colors" and "Dither strength". Off by default (plain pixelation).
- **Download**: click "Download PNG" to save the pixelated image.
- **Start over**: click "Reset".

Very large images are capped at 4096px on the longest side when loaded, and
EXIF orientation is respected automatically.

## Run locally

No build step or dependencies — just serve the folder statically:

```sh
python3 -m http.server
```

Then open `http://localhost:8000` in your browser. (Opening `index.html`
directly via `file://` also works for most features, but a local server is
recommended for consistent clipboard/paste behavior.)

## License

MIT — see [LICENSE](LICENSE).
