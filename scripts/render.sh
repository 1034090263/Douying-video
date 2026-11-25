#!/bin/sh
# 渲染当前时间轴对应的视频 → out/<视频名>.mp4（响度标准化 -14 LUFS + 限幅）
set -e
cd "$(dirname "$0")/.."
VID=$(node -e "console.log(require('./src/generated/timeline.json').id || 'video')")
npx remotion render src/index.ts Story "out/$VID.raw.mp4" --log=error
ffmpeg -v error -y -i "out/$VID.raw.mp4" -c:v copy \
  -af loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.84:attack=1:release=60:level=false \
  -ar 48000 -c:a aac -b:a 192k "out/$VID.mp4"
rm "out/$VID.raw.mp4"
npx remotion still src/index.ts Cover "out/$VID-cover.png" --log=error
echo "→ out/$VID.mp4  out/$VID-cover.png"
