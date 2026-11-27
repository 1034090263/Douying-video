import React from 'react';
import {AbsoluteFill, Html5Audio, Img, Series, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, DISPLAY, FPS, SCENE_STARTS, THEME, TIMELINE} from './lib';
import {SCENES} from './scenes';
import {Background, Flash, Header, SceneImage, Seal, Sfx, Stickers, Subtitles} from './ui';

const END = TIMELINE.scenes.reduce((a, s) => a + s.durationInFrames, 0);
const IN = 9;
const OUT = 6;

type Tr = 'legacy' | 'fade' | 'cut' | 'dip' | 'whip' | 'zoom' | 'flash' | 'wipe' | 'iris';
const trOf = (i: number): Tr => {
  const sc = TIMELINE.scenes[i] as {data?: {transition?: Tr}} | undefined;
  return sc?.data?.transition ?? (THEME.transition === 'fade' ? 'fade' : 'legacy');
};
/** 每种转场：出场（上一镜最后 n 帧）、进场（本镜头前 n 帧）各自的时长 */
const TR_LEN: Record<Tr, [number, number]> = {legacy: [OUT, IN], fade: [12, 14], cut: [0, 0], dip: [10, 12], whip: [7, 8], zoom: [8, 10], flash: [0, 9], wipe: [0, 0], iris: [10, 12]};

/** 转场在一侧的效果：k 从 0（转场最强）到 1（正常画面）；dir 区分出/进 */
const trStyle = (tr: Tr, k: number, out: boolean): React.CSSProperties => {
  const e = 1 - k; // 转场强度
  switch (tr) {
    case 'legacy':
      return {opacity: k, transform: `scale(${out ? 1 - 0.08 * e : 1.16 - 0.16 * k * k})`, filter: e > 0.02 ? `blur(${e * (out ? 14 : 18)}px)` : undefined};
    case 'fade':
    case 'dip':
      return {opacity: k};
    case 'whip': // 甩镜：整幅画面横甩出去，下一镜从另一侧甩进来
      return {transform: `translateX(${(out ? -1 : 1) * e * e * 380}px) scale(${1 + e * 0.38}) skewX(${(out ? 1 : -1) * e * 6}deg)`, filter: e > 0.02 ? `blur(${e * 30}px) brightness(${1 + e * 0.25})` : undefined};
    case 'zoom': // 穿越推进：冲进画面深处，下一镜从近处收回
      return {transform: `scale(${out ? 1 + e * e * 1.4 : 1 + e * e * 0.6})`, filter: e > 0.02 ? `blur(${e * 22}px) brightness(${1 + e * 0.6})` : undefined, opacity: out ? 1 - e * e * 0.5 : 1};
    case 'flash': // 白闪硬切 + 冲击
      return {transform: `scale(${1 + e * 0.1})`};
    case 'iris': // 光圈收拢/展开
      return {clipPath: `circle(${k * 75}% at 50% 45%)`};
    default:
      return {};
  }
};

const SceneFrame: React.FC<{scene: (typeof TIMELINE.scenes)[number]; index: number}> = ({scene, index}) => {
  const frame = useCurrentFrame();
  const dur = scene.durationInFrames;
  const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
  const inTr = trOf(index);
  const outTr = index + 1 < TIMELINE.scenes.length ? trOf(index + 1) : 'dip';
  const inLen = TR_LEN[inTr][1];
  const outLen = TR_LEN[outTr][0];
  const inK = inLen ? interpolate(frame, [0, inLen], [0, 1], clamp) : 1;
  const outK = outLen ? interpolate(frame, [dur - outLen, dur], [1, 0], clamp) : 1;
  const a = trStyle(inTr, inK, false);
  const b = trStyle(outTr, outK, true);
  const legacyPush = inTr === 'legacy' ? 1 + 0.035 * (frame / dur) : 1;
  const Template = SCENES[scene.type];
  if (!Template) throw new Error(`未知场景类型: ${scene.type}`);
  return (
    <AbsoluteFill style={{opacity: (a.opacity as number ?? 1) * (b.opacity as number ?? 1), clipPath: b.clipPath ?? a.clipPath}}>
      <AbsoluteFill style={{transform: `${a.transform ?? ''} ${b.transform ?? ''} scale(${legacyPush})`, filter: [a.filter, b.filter].filter(Boolean).join(' ') || undefined}}>
        {scene.image && <SceneImage src={scene.image} duration={dur} />}
        <Template scene={scene} />
        <Stickers scene={scene} />
      </AbsoluteFill>
      <Subtitles scene={scene} />
      <Html5Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};

/** 前景遮挡划过：一根近景柱子/黑影从右往左扫过，正好在切镜那一帧盖满画面 */
const Wipe: React.FC<{at: number}> = ({at}) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [at - 9, at + 9], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (k <= 0 || k >= 1) return null;
  const x = 1100 - k * 3000; // 黑影左边缘
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', left: x, top: -100, width: 1900, height: 2120, background: 'linear-gradient(90deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.96) 14%, #05060a 50%, rgba(5,6,10,0.96) 86%, rgba(5,6,10,0) 100%)', filter: 'blur(6px)'}} />
      <Img src={staticFile(`images/${(THEME as {images?: string}).images ?? TIMELINE.id}/prop_fg_pillar.png`)} style={{position: 'absolute', left: x + 120, top: -200, height: 2400, filter: 'blur(10px) brightness(0.35)'}} />
    </AbsoluteFill>
  );
};

export const Story: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    <Background />
    <Series>
      {TIMELINE.scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={s.durationInFrames}>
          <SceneFrame scene={s} index={i} />
        </Series.Sequence>
      ))}
    </Series>
    {SCENE_STARTS.slice(1).map((at, j) => {
      const tr = trOf(j + 1);
      return (
        <React.Fragment key={at}>
          {tr === 'legacy' && <Flash at={at} color="#ffcf7a" strength={0.35} dur={8} />}
          {(tr === 'legacy' || tr === 'whip' || tr === 'zoom' || tr === 'wipe') && <Sfx at={at - 9} name="whoosh" volume={0.55} />}
          {tr === 'flash' && <Flash at={at} color="#fff" strength={0.9} dur={10} />}
          {tr === 'flash' && <Sfx at={at - 1} name="boom" volume={0.45} />}
          {tr === 'wipe' && <Wipe at={at} />}
        </React.Fragment>
      );
    })}
    {/* 收尾：最后一句说完后重击 + 闪光 */}
    <Sfx at={END - FPS - 2} name="boom" volume={0.6} />
    <Flash at={END - FPS} strength={0.6} dur={14} />
    <Header title={TIMELINE.title} />
    {TIMELINE.bgm && <Html5Audio src={staticFile(TIMELINE.bgm)} volume={0.32} />}
  </AbsoluteFill>
);

/** 抖音封面：文字取自 script.json 的 cover */
export const Cover: React.FC = () => {
  const cv = TIMELINE.cover ?? {};
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Background />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 30}}>
        <Seal text={cv.seal ?? THEME.seal ?? '史'} size={130} />
        <div style={{fontFamily: DISPLAY, fontWeight: 900, fontSize: 140, lineHeight: 1.25, color: C.paper, textAlign: 'center', letterSpacing: 8}}>
          {cv.line1 ?? TIMELINE.title}
          {cv.line2 && (
            <>
              <br />
              <span style={{color: C.gold, textShadow: `0 0 50px ${C.gold}66`}}>{cv.line2}</span>
            </>
          )}
        </div>
        {cv.tag && <div style={{fontFamily: DISPLAY, fontSize: 60, color: '#f7e9d8', background: C.red, padding: '12px 50px', letterSpacing: 6}}>{cv.tag}</div>}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
