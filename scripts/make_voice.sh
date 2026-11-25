#!/bin/sh
# 生成默认的解说参考音色 voices/narrator.wav（IndexTTS2 克隆这个音色）
# 想换成自己的声音：录一段 10 秒左右的干声，覆盖 voices/narrator.wav 即可
set -e
cd "$(dirname "$0")/.."
mkdir -p voices
.venv/bin/edge-tts --voice zh-CN-YunjianNeural --rate=-6% \
  --text "两千多年前，一个少年登上了王位。他用了十年，扫平六国，建立起中国历史上第一个大一统王朝。可谁也没有想到，这个帝国的结局，会来得如此之快。" \
  --write-media /tmp/narrator.mp3
ffmpeg -v error -y -i /tmp/narrator.mp3 -t 11 -ar 24000 -ac 1 voices/narrator.wav
echo "→ voices/narrator.wav"
