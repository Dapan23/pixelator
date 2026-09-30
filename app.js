"use strict";

// --- Constants ---------------------------------------------------------
const MAX_DIMENSION = 4096; // cap very large images on load
const DEFAULT_PIXEL_SIZE = 8;

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
const downloadBtn = document.getElementById("download-btn");
const resetBtn = document.getElementById("reset-btn");

const originalCtx = originalCanvas.getContext("2d");
const outputCtx = outputCanvas.getContext("2d");

// Offscreen canvas used as the intermediate "tiny" downscale step.
const tinyCanvas = document.createElement("canvas");
const tinyCtx = tinyCanvas.getContext("2d");

let currentFileBaseName = "pixelated";

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

  outputCanvas.width = width;
  outputCanvas.height = height;

  pixelSizeInput.value = DEFAULT_PIXEL_SIZE;
  pixelSizeValue.textContent = DEFAULT_PIXEL_SIZE;
  compareToggle.checked = false;
  updateCompareVisibility();

  dropZone.hidden = true;
  editor.hidden = false;

  pixelate();
}

// --- Pixelation -----------------------------------------------------------

function pixelate() {
  const width = originalCanvas.width;
  const height = originalCanvas.height;
  const pixelSize = Number(pixelSizeInput.value);

  const gridW = Math.max(1, Math.round(width / pixelSize));
  const gridH = Math.max(1, Math.round(height / pixelSize));

  // Downscale with smoothing on: each tiny pixel approximates the average
  // color of the block it represents.
  tinyCanvas.width = gridW;
  tinyCanvas.height = gridH;
  tinyCtx.imageSmoothingEnabled = true;
  tinyCtx.imageSmoothingQuality = "high";
  tinyCtx.clearRect(0, 0, gridW, gridH);
  tinyCtx.drawImage(originalCanvas, 0, 0, gridW, gridH);

  // Upscale with smoothing off: blocks stay crisp (nearest-neighbor).
  outputCtx.imageSmoothingEnabled = false;
  outputCtx.clearRect(0, 0, width, height);
  outputCtx.drawImage(tinyCanvas, 0, 0, width, height);

  infoLine.textContent = `Output: ${width} × ${height}px — Grid: ${gridW} × ${gridH} blocks`;
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
  originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  infoLine.textContent = "";
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

downloadBtn.addEventListener("click", downloadPng);
resetBtn.addEventListener("click", reset);
