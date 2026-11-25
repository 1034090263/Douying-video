#!/bin/sh
# 一键出片：npm run build -- <视频名>（省略则沿用上次的视频）
set -e
cd "$(dirname "$0")/.."
.venv/bin/python scripts/tts.py $1
.venv/bin/python scripts/audio.py
sh scripts/render.sh
