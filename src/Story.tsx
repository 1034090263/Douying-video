import React from 'react';
import {AbsoluteFill, Html5Audio, Series, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, DISPLAY, FPS, SCENE_STARTS, THEME, TIMELINE} from './lib';
import {SCENES} from './scenes';
import {Background, Flash, Header, SceneImage, Seal, Sfx, Stickers, Subtitles} from './ui';

const END = TIMELINE.scenes.reduce((a, s) => a + s.durationInFrames, 0);
const IN = 9;
const OUT = 6;

const SceneFrame: React.FC<{scene: (typeof TIMELINE.scenes)[number]}> = ({scene}) => {
  const frame = useCurrentFrame();
  const dur = scene.durationInFrames;
  const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
  // 转场：进场从放大+模糊收拢，出场缩小+模糊淡出；全程缓慢推镜
  const fade = THEME.transition === 'fade';
  const inP = interpolate(frame, [0, fade ? 14 : IN], [0, 1], clamp);
  const outP = interpolate(frame, [dur - (fade ? 12 : OUT), dur], [0, 1], clamp);
  const push = fade ? 1 : 1 + 0.035 * (frame / dur);
  const scale = fade ? 1 : (1.16 - 0.16 * inP * inP) * (1 - 0.08 * outP) * push;
  const blur = fade ? 0 : (1 - inP) * 18 + outP * 14;
  const Template = SCENES[scene.type];
  if (!Template) throw new Error(`未知场景类型: ${scene.type}`);
  return (
    <AbsoluteFill style={{opacity: inP * (1 - outP), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined}}>
      {scene.image && <SceneImage src={scene.image} duration={dur} />}
      <Template scene={scene} />
      <Stickers scene={scene} />
      <Subtitles scene={scene} />
      <Html5Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};

export const Story: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    <Background />
    <Series>
      {TIMELINE.scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={s.durationInFrames}>
          <SceneFrame scene={s} />
        </Series.Sequence>
      ))}
    </Series>
    {THEME.transition !== 'fade' && SCENE_STARTS.slice(1).map((at) => (
      <React.Fragment key={at}>
        <Sfx at={at - 9} name="whoosh" volume={0.55} />
        <Flash at={at} color="#ffcf7a" strength={0.35} dur={8} />
      </React.Fragment>
    ))}
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
