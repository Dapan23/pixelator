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
const originalCanvas = document.getElementById("original-canvas");
const outputCanvas = document.getElementById("output-canvas");
const infoLine = document.getElementById("info-line");
const pixelSizeInput = document.getElementById("pixel-size");
const pixelSizeValue = document.getElementById("pixel-size-value");
const compareToggle = document.getElementById("compare-toggle");
const ditherToggle = document.getElementById("dither-toggle");
const ditherOptions = document.getElementById("dither-options");
const ditherColorsInput = document.getElementById("dither-colors");
const ditherColorsValue = document.getElementById("dither-colors-value");
const ditherStrengthInput = document.getElementById("dither-strength");
const ditherStrengthValue = document.getElementById("dither-strength-value");
const downloadBtn = document.getElementById("download-btn");
const resetBtn = document.getElementById("reset-btn");

const originalCtx = originalCanvas.getContext("2d");
const outputCtx = outputCanvas.getContext("2d");

// Offscreen canvas holding the small grid of averaged block colors, drawn
// via putImageData (an exact pixel write — never smoothed/interpolated).
const tinyCanvas = document.createElement("canvas");
const tinyCtx = tinyCanvas.getContext("2d");

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

  originalCanvas.width = width;
  originalCanvas.height = height;
  originalCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  sourceImageData = originalCtx.getImageData(0, 0, width, height);

  pixelSizeInput.value = DEFAULT_PIXEL_SIZE;
  pixelSizeValue.textContent = DEFAULT_PIXEL_SIZE;
  compareToggle.checked = false;
  updateCompareVisibility();
  ditherToggle.checked = false;
  updateDitherControlsEnabled();

  dropZone.hidden = true;
  editor.hidden = false;

  pixelate();
}

// --- Pixelation -----------------------------------------------------------

// Forces nearest-neighbor scaling on a context. Resizing a canvas (setting
// .width/.height) resets all context state, including imageSmoothingEnabled,
// so this must be called again after every resize, right before drawing.
function setNoSmoothing(ctx) {
  ctx.imageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.msImageSmoothingEnabled = false;
}

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

function pixelate() {
  if (!sourceImageData) return;

  const width = originalCanvas.width;
  const height = originalCanvas.height;
  const pixelSize = Number(pixelSizeInput.value);

  // Integer block grid, so the upscale below is an exact integer factor —
  // no fractional blocks or uneven edges.
  const blocksX = Math.max(1, Math.round(width / pixelSize));
  const blocksY = Math.max(1, Math.round(height / pixelSize));
  const outputW = blocksX * pixelSize;
  const outputH = blocksY * pixelSize;

  const smallImageData = computeBlockAverages(sourceImageData, width, height, blocksX, blocksY);

  if (ditherToggle.checked) {
    const numColors = Number(ditherColorsInput.value);
    const strength = Number(ditherStrengthInput.value) / 100;
    applyOrderedDither(smallImageData, blocksX, blocksY, numColors, strength);
  }

  // Write the averaged colors as an exact pixel copy (no smoothing involved).
  tinyCanvas.width = blocksX;
  tinyCanvas.height = blocksY;
  tinyCtx.putImageData(smallImageData, 0, 0);

  // Scale up by the exact integer pixelSize factor with smoothing off, so
  // every block stays a single flat color with hard edges.
  outputCanvas.width = outputW;
  outputCanvas.height = outputH;
  setNoSmoothing(outputCtx);
  outputCtx.drawImage(tinyCanvas, 0, 0, outputW, outputH);

  infoLine.textContent = `Output: ${outputW} × ${outputH}px — Grid: ${blocksX} × ${blocksY} blocks`;
}

// --- Dither controls ----------------------------------------------------

function updateDitherControlsEnabled() {
  const enabled = ditherToggle.checked;
  ditherColorsInput.disabled = !enabled;
  ditherStrengthInput.disabled = !enabled;
  ditherOptions.classList.toggle("disabled", !enabled);
}

// --- Compare toggle ---------------------------------------------------

function updateCompareVisibility() {
  const showOriginal = compareToggle.checked;
  originalCanvas.hidden = !showOriginal;
  outputCanvas.hidden = showOriginal;
}

// --- Download / Reset -------------------------------------------------

function downloadPng() {
  outputCanvas.toBlob((blob) => {
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
  originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
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

compareToggle.addEventListener("change", updateCompareVisibility);

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
