import {Easing, interpolate} from 'remotion';
import timeline from './generated/timeline.json';

export type Subtitle = {text: string; start: number; end: number};
export type SceneData = {
  type: string;
  // 各模板自己的字段，见 script.json
  data: any;
  narration: string;
  audio: string;
  image: string | null;
  durationInFrames: number;
  charTimes: (number | null)[];
  subtitles: Subtitle[];
};

export type Theme = {
  style?: 'ink' | 'hextech' | 'plain'; // 背景风格：宣纸水墨 / 海克斯科技 / 纯色（插画镜头自带背景）
  mark?: string; // 背景巨大水印字
  seal?: string; // 栏目头印章字
  font?: 'serif' | 'sans'; // 画面文字字体
  colors?: Partial<typeof DEFAULT_COLORS>;
  regions?: Record<string, string>; // 赛区 → 颜色（冠军墙用）
  keywords?: string[]; // 字幕里额外高亮的关键词
  wall?: {tag: string; year: string; team: string; region: string}[]; // 冠军墙数据
  transition?: 'zoom' | 'fade'; // 转场：放大模糊+闪光（默认）/ 淡入淡出（叙事类）
};

export type Sticker = {text: string; cue?: string; x?: number; y?: number; rot?: number; color?: string};

export const TIMELINE = timeline as unknown as {
  id: string;
  title: string;
  fps: number;
  bgm: string | null;
  theme?: Theme;
  cover?: {seal?: string; line1?: string; line2?: string; tag?: string};
  scenes: (SceneData & {stickers?: Sticker[]; intensity?: number})[];
};
export const FPS = TIMELINE.fps;
export const THEME: Theme = TIMELINE.theme ?? {};

const DEFAULT_COLORS = {
  bg: '#120d0a',
  paper: '#efe4cc',
  dim: '#a89a80',
  gold: '#d9ad5c',
  red: '#b8281f',
  redDeep: '#6e140f',
  accent: '#f0a24a', // 背景粒子
  highlight: '#ffd45e', // 字幕关键词
};
export const C = {...DEFAULT_COLORS, ...THEME.colors};
const SERIF_STACK = '"Noto Serif CJK SC", "Noto Serif CJK TC", serif';
export const SANS = '"Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif';
/** 画面文字字体（主题可切换宋体/黑体）；字幕固定用 SANS */
export const DISPLAY = THEME.font === 'sans' ? SANS : SERIF_STACK;

// 竖屏安全区：顶部留给抖音标签栏，底部/右侧留给标题和按钮
export const LAYOUT = {contentTop: 380, contentHeight: 900, subtitleTop: 1330};

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

/** 从 start 帧开始，在 dur 帧内 0→1 */
export const prog = (frame: number, start: number, dur = 15) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });

/** 旁白念到 cue 这个词时的帧号；找不到就用 fallbackSec */
export const cueFrame = (scene: SceneData, cue: string | undefined, fallbackSec = 0) => {
  const idx = cue ? scene.narration.indexOf(cue) : -1;
  const t = idx >= 0 ? scene.charTimes[idx] : null;
  return Math.round((t ?? fallbackSec) * FPS);
};

// ---------------------------------------------------------------- 与配乐同步（须与 scripts/audio.py 保持一致）
export const BPM = (TIMELINE.theme as {bpm?: number} | undefined)?.bpm ?? 96;
export const BEAT_FRAMES = (FPS * 60) / BPM;
const INTENSITY: Record<string, number> = {hook: 0.35, timeline: 0.6, stats: 0.75, quote: 0.8, chain: 1, wall: 0.85, summary: 0.55, shot: 0.5};

export const sceneKind = (s: SceneData) =>
  s.type === 'quote' && String(s.data?.label ?? '').includes('总结') ? 'summary' : s.type;

export const SCENE_STARTS = TIMELINE.scenes.reduce<number[]>((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + TIMELINE.scenes[i - 1].durationInFrames);
  return acc;
}, []);

const hook = TIMELINE.scenes[0];
const DRUMS_FROM = hook?.type === 'hook' ? cueFrame(hook, hook.data?.bigCue, 0) : 0;

/** 全片某帧的音乐强度（鼓点进来之前为 0） */
export const energyAt = (frame: number) => {
  if (frame < DRUMS_FROM) return 0;
  for (let i = SCENE_STARTS.length - 1; i >= 0; i--) {
    if (frame >= SCENE_STARTS[i]) return TIMELINE.scenes[i].intensity ?? INTENSITY[sceneKind(TIMELINE.scenes[i])] ?? 0.6;
  }
  return 0;
};

/** 节拍脉冲：每拍开头为 1，随后快速衰减；强拍（小节第一拍）更强 */
export const beatPulse = (frame: number) => {
  if (frame < DRUMS_FROM) return 0;
  const b = frame / BEAT_FRAMES;
  const phase = (b - Math.floor(b)) * BEAT_FRAMES;
  const downbeat = Math.floor(b) % 4 === 0 ? 1 : 0.55;
  return Math.exp(-phase / 3.5) * downbeat * energyAt(frame);
};

/** 冲击抖动：impacts 为触发帧列表 */
export const shake = (frame: number, impacts: number[], amp = 22) => {
  let x = 0;
  let y = 0;
  for (const at of impacts) {
    const k = frame - at;
    if (k >= 0 && k < 14) {
      const fall = Math.pow(1 - k / 14, 2) * amp;
      x += Math.sin(k * 2.7 + at) * fall;
      y += Math.cos(k * 3.3 + at) * fall * 0.7;
    }
  }
  return `translate(${x}px, ${y}px)`;
};
