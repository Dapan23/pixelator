# Pixelator

A tiny, dependency-free web app that turns a photo into a clean pixelated
image. No color filters, no dithering, no palettes — pixelation is the only
transformation.

## How it works

1. Load a photo (file picker, drag-and-drop, or paste).
2. Drag the **Pixel size** slider (2–64px per block). The image is downscaled
   to a tiny canvas (averaging each block's color) and then upscaled back to
   full size with nearest-neighbor scaling, so the blocks stay sharp.
3. Click **Download PNG** to save the result.

Colors are left exactly as sampled from the original photo — nothing is
recolored, dithered, or mapped to a palette.

## Usage

- **Load an image**: click the drop zone to browse, drag a file onto it, or
  paste (Ctrl+V / Cmd+V) an image from your clipboard.
- **Adjust pixel size**: drag the slider for a live preview.
- **Compare with the original**: check the "Show original" toggle.
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
