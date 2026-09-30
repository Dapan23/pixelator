"use strict";

// --- Constants ---------------------------------------------------------
const MAX_DIMENSION = 4096; // cap very large images on load
const DEFAULT_PIXEL_SIZE = 4;

// 4x4 ordered (Bayer) dither matrix, values 0-15.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// --- DOM references -----------------------------------------------------
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const editor = document.getElementById("editor");
const canvasStage = document.getElementById("canvas-stage");
const previewCanvas = document.getElementById("preview-canvas");
const infoLine = document.getElementById("info-line");
const pixelSizeInput = document.getElementById("pixel-size");
const pixelSizeValue = document.getElementById("pixel-size-value");
const ditherToggle = document.getElementById("dither-toggle");
const ditherOptions = document.getElementById("dither-options");
const ditherColorsInput = document.getElementById("dither-colors");
const ditherColorsValue = document.getElementById("dither-colors-value");
const ditherStrengthInput = document.getElementById("dither-strength");
const ditherStrengthValue = document.getElementById("dither-strength-value");
const downloadBtn = document.getElementById("download-btn");
const resetBtn = document.getElementById("reset-btn");

const previewCtx = previewCanvas.getContext("2d");

// Offscreen canvas (never attached to the DOM) holding the loaded photo at
// full resolution, used only to read its raw pixels via getImageData.
const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d");

// Offscreen canvas (never attached to the DOM) holding the true
// full-resolution pixelated result. This, not the on-screen preview, is
// what Download PNG exports — the preview may be painted at a smaller
// integer scale to fit the screen, but the download is always full-res.
const fullCanvas = document.createElement("canvas");
const fullCtx = fullCanvas.getContext("2d");

let currentFileBaseName = "pixelated";
let sourceImageData = null; // cached full-res pixel data of the loaded image

// --- Image loading --------------------------------------------------------

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showStatus("Please choose an image file.");
    return;
  }

  hideStatus();
  currentFileBaseName = file.name.replace(/\.[^/.]+$/, "") || "pixelated";

  let bitmap;
  try {
    // imageOrientation: "from-image" applies EXIF rotation automatically.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    showStatus("Could not load that image. Please try a different file.");
    return;
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  sourceImageData = sourceCtx.getImageData(0, 0, width, height);

  pixelSizeInput.value = DEFAULT_PIXEL_SIZE;
  pixelSizeValue.textContent = DEFAULT_PIXEL_SIZE;
  ditherToggle.checked = false;
  updateDitherControlsEnabled();

  dropZone.hidden = true;
  editor.hidden = false;

  pixelate();
}

// --- Pixelation -----------------------------------------------------------

// Computes the exact mean color of every block by summing raw source pixels
// (getImageData), rather than relying on the browser's downscale filter —
// this is what guarantees each block is a single flat color with no
// bilinear blending at block edges.
function computeBlockAverages(imageData, width, height, blocksX, blocksY) {
  const src = imageData.data;

  const bxForX = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    bxForX[x] = Math.min(blocksX - 1, Math.floor((x * blocksX) / width));
  }
  const byForY = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    byForY[y] = Math.min(blocksY - 1, Math.floor((y * blocksY) / height));
  }

  const blockCount = blocksX * blocksY;
  const sums = new Float64Array(blockCount * 4);
  const counts = new Uint32Array(blockCount);

  for (let y = 0; y < height; y++) {
    const rowBlockBase = byForY[y] * blocksX;
    const rowPixelBase = y * width;
    for (let x = 0; x < width; x++) {
      const block = rowBlockBase + bxForX[x];
      const si = (rowPixelBase + x) * 4;
      const di = block * 4;
      sums[di] += src[si];
      sums[di + 1] += src[si + 1];
      sums[di + 2] += src[si + 2];
      sums[di + 3] += src[si + 3];
      counts[block]++;
    }
  }

  const averaged = new ImageData(blocksX, blocksY);
  const dst = averaged.data;
  for (let b = 0; b < blockCount; b++) {
    const count = counts[b] || 1;
    const di = b * 4;
    dst[di] = Math.round(sums[di] / count);
    dst[di + 1] = Math.round(sums[di + 1] / count);
    dst[di + 2] = Math.round(sums[di + 2] / count);
    dst[di + 3] = Math.round(sums[di + 3] / count);
  }
  return averaged;
}

// Ordered (Bayer 4x4) dithering + posterization, applied per block using the
// block's grid position. Mutates imageData in place.
function applyOrderedDither(imageData, blocksX, blocksY, numColors, strength) {
  const levels = Math.max(2, numColors);
  const step = 255 / (levels - 1);
  const data = imageData.data;

  for (let by = 0; by < blocksY; by++) {
    const bayerRow = BAYER_4X4[by % 4];
    for (let bx = 0; bx < blocksX; bx++) {
      const threshold = (bayerRow[bx % 4] + 0.5) / 16 - 0.5; // -0.5..0.5
      const offset = threshold * strength * step;
      const i = (by * blocksX + bx) * 4;
      for (let c = 0; c < 3; c++) {
        const quantized = Math.round((data[i + c] + offset) / step) * step;
        data[i + c] = Math.min(255, Math.max(0, quantized));
      }
    }
  }
}

// Paints one flat-colored rectangle per block directly onto a context —
// no drawImage, no scaling, no smoothing flag involved at all, so there is
// no code path left that could blend colors across a block edge.
function paintBlocks(ctx, blockData, blocksX, blocksY, scale) {
  const data = blockData.data;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const i = (by * blocksX + bx) * 4;
      ctx.fillStyle = `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`;
      ctx.fillRect(bx * scale, by * scale, scale, scale);
    }
  }
}

// Width available for the preview canvas inside its container, used to pick
// an integer display scale so the browser never has to CSS-scale the
// canvas (see the overflow:auto comment in style.css for why that matters).
function getAvailableWidth() {
  const style = getComputedStyle(canvasStage);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = canvasStage.clientWidth - paddingX;
  return width > 0 ? width : 320;
}

function pixelate() {
  if (!sourceImageData) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const pixelSize = Number(pixelSizeInput.value);

  // Integer block grid, so every scale used below is an exact integer
  // factor — no fractional blocks or uneven edges.
  const blocksX = Math.max(1, Math.round(width / pixelSize));
  const blocksY = Math.max(1, Math.round(height / pixelSize));
  const outputW = blocksX * pixelSize;
  const outputH = blocksY * pixelSize;

  const averages = computeBlockAverages(sourceImageData, width, height, blocksX, blocksY);

  if (ditherToggle.checked) {
    const numColors = Number(ditherColorsInput.value);
    const strength = Number(ditherStrengthInput.value) / 100;
    applyOrderedDither(averages, blocksX, blocksY, numColors, strength);
  }

  // Full-resolution result — the single source of truth for Download PNG.
  fullCanvas.width = outputW;
  fullCanvas.height = outputH;
  paintBlocks(fullCtx, averages, blocksX, blocksY, pixelSize);

  // On-screen preview: painted at whatever integer scale fits the
  // available width (capped at the true pixelSize, never upscaled beyond
  // it). Its canvas pixel dimensions equal its on-screen size exactly, so
  // no CSS scaling — and therefore no browser smoothing — ever applies.
  const displayScale = Math.max(1, Math.min(pixelSize, Math.floor(getAvailableWidth() / blocksX)));
  previewCanvas.width = blocksX * displayScale;
  previewCanvas.height = blocksY * displayScale;
  paintBlocks(previewCtx, averages, blocksX, blocksY, displayScale);

  infoLine.textContent = `Output: ${outputW} × ${outputH}px — Grid: ${blocksX} × ${blocksY} blocks`;
}

// --- Dither controls ----------------------------------------------------

function updateDitherControlsEnabled() {
  const enabled = ditherToggle.checked;
  ditherColorsInput.disabled = !enabled;
  ditherStrengthInput.disabled = !enabled;
  ditherOptions.classList.toggle("disabled", !enabled);
}

// --- Download / Reset -------------------------------------------------

function downloadPng() {
  fullCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentFileBaseName}-pixelated.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function reset() {
  editor.hidden = true;
  dropZone.hidden = false;
  fileInput.value = "";
  hideStatus();
  sourceImageData = null;
  previewCanvas.width = 0;
  previewCanvas.height = 0;
  infoLine.textContent = "";
  ditherToggle.checked = false;
  ditherColorsInput.value = 8;
  ditherColorsValue.textContent = "8";
  ditherStrengthInput.value = 50;
  ditherStrengthValue.textContent = "50";
  updateDitherControlsEnabled();
  dropZone.focus();
}

// --- Status messages ----------------------------------------------------

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

// --- Event wiring ---------------------------------------------------------

dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "dragend"].forEach((evt) => {
  dropZone.addEventListener(evt, () => {
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

document.addEventListener("paste", (e) => {
  const items = e.clipboardData ? e.clipboardData.items : [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) loadFile(file);
      break;
    }
  }
});

pixelSizeInput.addEventListener("input", () => {
  pixelSizeValue.textContent = pixelSizeInput.value;
  pixelate();
});

ditherToggle.addEventListener("change", () => {
  updateDitherControlsEnabled();
  pixelate();
});

ditherColorsInput.addEventListener("input", () => {
  ditherColorsValue.textContent = ditherColorsInput.value;
  pixelate();
});

ditherStrengthInput.addEventListener("input", () => {
  ditherStrengthValue.textContent = ditherStrengthInput.value;
  pixelate();
});

downloadBtn.addEventListener("click", downloadPng);
resetBtn.addEventListener("click", reset);

// Recompute the preview's display scale when the viewport changes, so it
// keeps fitting the container at an exact integer scale.
let resizePending = false;
window.addEventListener("resize", () => {
  if (!sourceImageData || resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    pixelate();
  });
});
