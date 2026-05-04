#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="assets/models"
EMBEDDER_PATH="$MODEL_DIR/bge-small.onnx"
RERANKER_PATH="$MODEL_DIR/reranker.onnx"

# ── Download bge-small.onnx from HuggingFace ────────────────────
if [ ! -f "$EMBEDDER_PATH" ]; then
  echo "[pre-install] Downloading bge-small.onnx (~127MB) from HuggingFace..."
  mkdir -p "$MODEL_DIR"
  curl -L \
    --retry 3 \
    --retry-delay 5 \
    --progress-bar \
    "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx" \
    -o "$EMBEDDER_PATH"
  echo "[pre-install] ✅ Embedder downloaded: $(du -sh $EMBEDDER_PATH | cut -f1)"
else
  echo "[pre-install] ✅ bge-small.onnx already present, skipping"
fi

# ── Verify embedder isn't corrupted (should be ~127MB) ───────────
FILE_SIZE=$(wc -c < "$EMBEDDER_PATH")
if [ "$FILE_SIZE" -lt 10000000 ]; then
  echo "[pre-install] ❌ FATAL: bge-small.onnx is too small (${FILE_SIZE} bytes) — download likely failed"
  exit 1
fi

# ── Download your own TinyBERT-L-2-v2 ONNX ─────
RERANKER_PATH="assets/models/reranker.onnx"
RERANKER_ZIP="/tmp/tinybert_reranker.zip"

echo "[pre-install] Removing any old reranker to force fresh download"
rm -f "$RERANKER_PATH"

echo "[pre-install] Downloading custom TinyBERT-L-2-v2 ONNX (~25MB)..."
curl -L --retry 5 --retry-delay 10 --progress-bar \
  "https://huggingface.co/amardev/ms-marco-TinyBERT-L-2-v2-onnx/resolve/main/ms-marco-TinyBERT-L-2-v2-onnx.zip" \
  -o "$RERANKER_ZIP"

unzip -p "$RERANKER_ZIP" 'model.onnx' > "$RERANKER_PATH"
rm "$RERANKER_ZIP"

FILE_SIZE=$(wc -c < "$RERANKER_PATH")
if [ "$FILE_SIZE" -lt 15000000 ]; then
  echo "[pre-install] ❌ FATAL: reranker.onnx too small (${FILE_SIZE} bytes)"
  exit 1
fi
echo "[pre-install] ✅ Custom TinyBERT reranker: ${FILE_SIZE} bytes"

echo "[pre-install] ✅ All model assets ready"