# Douying-video · 代码生成抖音解说视频

一句话概括：**写好分镜脚本（JSON）→ 本地 AI 配音 → 程序合成配乐音效 →（可选）本地 AI 生成插画 → Remotion 逐帧渲染 → 1080×1920 竖屏成片**。

全流程在本机运行，不依赖在线视频素材、模板或版权音乐。制作标准、字号、语速、节奏、各类反馈的调整记录见 [STYLE.md](STYLE.md)。

## 已做的视频

| 名字 | 题材 | 风格 | 时长 |
|---|---|---|---|
| `qin` | 秦朝为什么二世而亡 | 历史科普 · 宣纸水墨 · 古筝太鼓配乐 | 约 1 分钟 |
| `lol` | 英雄联盟十七年 | 电竞编年史 · 海克斯科技 · 冠军墙 + 选手热梗贴纸 · 电子配乐 | 约 5 分钟 |
| `byakuya` | 白夜行 · 上（原著第 1~3 章） | 小说解说 · AI 插画 + 2.5D 视差 + 人物表演 · 钢琴配乐 | 约 4.5 分钟 |

## 出片

```bash
npm run build -- <名字>        # 一键：配音 → 配乐 → 渲染 → out/<名字>.mp4 + 封面
```

分步：

```bash
npm run tts -- <名字>          # IndexTTS2 配音 + 字幕/逐字时间轴 → src/generated/timeline.json
npm run audio                 # 按时间轴合成配乐和音效
npm run dev                   # 浏览器实时预览（Remotion Studio）
npm run render                # 渲染 + 响度标准化 → out/<名字>.mp4
```

插画类视频（如 `byakuya`）先生成素材：

```bash
~/imggen/.venv/bin/python scripts/imagegen.py <名字>   # 角色定妆照/姿势、道具、背景
~/imggen/.venv/bin/python scripts/depth.py <名字>      # 背景 2.5D 视差遮罩
```

## 目录

```
videos/<名字>/script.json   分镜脚本：旁白、情绪、模板、画面元素、cue（念到哪个词时出现）
videos/<名字>/art.json      插画素材的描述（画风、角色、道具、背景）
src/                        Remotion 渲染代码
  lib.ts                    主题、时间轴、cue 换算、节拍
  ui.tsx                    背景、字幕、印章、贴纸、闪光/冲击波/粒子等通用组件
  scenes.tsx                模板：hook 开场 / timeline 时间轴 / stats 数据 / quote 引用 / chain 因果链 / wall 冠军墙
  shot.tsx                  插画镜头：视差背景、人物表演、天气光效、推镜、重音
  chibi.tsx / stage.tsx     Q 版贴纸小人与舞台（适合轻松题材）
  Story.tsx / Root.tsx      整片编排、转场、封面
scripts/
  tts.py                    配音（IndexTTS2 / edge-tts）+ 停顿检测对齐 + 字幕
  index_worker.py           在 IndexTTS2 环境里批量合成
  audio.py                  程序合成配乐（古筝 / 电子 / 钢琴）与音效、剧情重音、心跳
  imagegen.py               FLUX.2 klein 出图 + BiRefNet 抠图
  depth.py                  Depth Anything V2 视差遮罩
  render.sh / build.sh      渲染与一键出片
  make_voice.sh             生成默认参考音色
vendor/                     借鉴的代码生成视频风格库（git 子模块，见下）
STYLE.md                    制作规范 + 反馈记录
```

## 安装

1. **Node.js 18+**、**ffmpeg**、中文字体（Noto Sans/Serif CJK SC）
2. 渲染依赖：`npm install`（首次渲染会自动下载无头 Chrome）
3. 主 Python 环境：
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   sh scripts/make_voice.sh          # 生成 voices/narrator.wav
   ```
4. **配音 IndexTTS2**（需要 NVIDIA 显卡）：克隆 [index-tts](https://github.com/index-tts/index-tts) 到 `~/tts/index-tts`，`uv sync`，下载 `IndexTeam/IndexTTS-2` 到 `checkpoints/`。没有显卡可在 `script.json` 里设 `"engine": "edge"` 改用 edge-tts。
5. **出图环境**（插画类视频才需要）：在 `~/imggen` 建 Python 3.11 环境，装 `torch`（CUDA）、`diffusers`、`transformers`、`timm`、`einops`、`kornia`，下载：
   - `black-forest-labs/FLUX.2-klein-4B` → `~/imggen/models/flux2-klein-4b`
   - `ZhengPeng7/BiRefNet` → `~/imggen/models/birefnet`
   - `depth-anything/Depth-Anything-V2-Small-hf` → `~/imggen/models/depth-v2-small`
6. 克隆本仓库时带上子模块：`git clone --recursive …`，或之后 `git submodule update --init`

## 借鉴的项目（vendor/）

作者 **肖雄 XIAOXIONG** 的三套「每一帧都由代码算出来」的视频风格库，均为 MIT 协议，以 git 子模块引用：

- [sy-style-100](https://github.com/xiaoxiong20xx-code/sy-style-100)：20 种风格 × 2 期 + 60 条行业示例
- [sy-style-new20](https://github.com/xiaoxiong20xx-code/sy-style-new20)：油画、刺绣、木版年画、皮影戏、沙画……
- [sy-style-more20](https://github.com/xiaoxiong20xx-code/sy-style-more20)：青花瓷、金缮、榫卯、X 光、冰雕……

它们是 1920×1080 横屏，用于本项目时需要改成竖屏构图；画面里的作者署名需替换，代码再分发时保留原作者署名。

## 第三方组件与协议

| 组件 | 用途 | 协议 |
|---|---|---|
| [Remotion](https://www.remotion.dev) | 渲染 | Remotion License（个人及小团队免费，公司规模较大需购买商业授权） |
| [IndexTTS2](https://github.com/index-tts/index-tts) | 配音 | 见其仓库 LICENSE |
| FLUX.2 [klein] 4B | 出图 | Apache 2.0 |
| BiRefNet | 抠图 | MIT |
| Depth Anything V2 Small | 景深 | Apache 2.0 |
| edge-tts | 备用配音 / 默认参考音色 | 调用微软在线语音，商用授权不明确，变现账号建议换成自己的音色 |
| 思源黑体 / 思源宋体 | 字体 | SIL OFL 1.1 |

视频内容涉及的作品（如《白夜行》）版权归原作者所有，本项目仅做剧情解说；发布到抖音时请勾选「AI 生成内容」声明。
