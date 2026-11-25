import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';
import {C, DISPLAY, FPS, SANS, SceneData, THEME, cueFrame, prog, shake} from './lib';
import {Burst, Content, Flash, Label, Ring, Seal, Sfx, Shine} from './ui';
import {ShotScene} from './shot';
import {StageScene} from './stage';

type P = {scene: SceneData};

const slam = (frame: number, at: number, from = 2.2, damping = 11) =>
  interpolate(spring({frame: frame - at, fps: FPS, config: {damping, stiffness: 170}}), [0, 1], [from, 1]);

/** 开场钩子：二世 → 三世 → 万世 逐级放大，被一刀划掉，「15年」砸下来 */
const Hook: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const titleAt = cueFrame(scene, d.titleCue, 1.5);
  const ladder = (d.ladder ?? []) as {text: string; cue: string}[];
  const ladderAts = ladder.map((l, i) => cueFrame(scene, l.cue, 3 + i * 0.6));
  const bigAt = cueFrame(scene, d.bigCue, 8);
  const strikeAt = bigAt - 14;
  const strike = prog(frame, strikeAt, 8);
  const after = prog(frame, bigAt, 16);
  const lineW = String(d.kicker).length > 6 ? 60 : 120;
  return (
    <>
      <Sfx at={bigAt - 45} name="riser" volume={0.7} />
      <Sfx at={strikeAt} name="whoosh" volume={0.8} />
      <Sfx at={bigAt} name="boom" volume={0.6} />
      <Sfx at={titleAt} name="stamp" volume={0.6} />
      {ladderAts.map((at, i) => (
        <Sfx key={i} at={at} name="pop" volume={0.5 + i * 0.15} />
      ))}
      <Content style={{alignItems: 'center', transform: shake(frame, [bigAt], 34)}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 28, opacity: prog(frame, 0, 15), marginTop: 10}}>
          <div style={{width: lineW * prog(frame, 0, 20), height: 2, background: C.gold}} />
          <div style={{fontFamily: DISPLAY, fontSize: 52, color: C.gold, letterSpacing: d.kicker.length > 6 ? 8 : 18, whiteSpace: 'nowrap'}}>{d.kicker}</div>
          <div style={{width: lineW * prog(frame, 0, 20), height: 2, background: C.gold}} />
        </div>
        {/* 始皇帝 */}
        <div
          style={{
            marginTop: 30,
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 120,
            letterSpacing: 24,
            opacity: frame >= titleAt ? 1 - after * 0.85 : 0,
            transform: `translateY(${-after * 60}px) scale(${slam(frame, titleAt, 1.8) * (1 - after * 0.3)})`,
            textShadow: '0 10px 30px #000',
          }}
        >
          <Shine at={titleAt} every={70}>{d.title}</Shine>
        </div>
        {/* 二世 → 三世 → 万世 */}
        <div style={{position: 'relative', marginTop: 40, display: 'flex', alignItems: 'baseline', gap: 26, opacity: 1 - strike * 0.5 - after * 0.42, transform: `translateY(${-after * 90}px) scale(${1 - after * 0.3})`}}>
          {ladder.map((l, i) => {
            const size = ladder.length > 1 ? 80 + (i / (ladder.length - 1)) * (ladder.length > 3 ? 60 : 90) : 140;
            return (
              <React.Fragment key={i}>
                {i > 0 && <div style={{fontSize: 48, color: C.dim, opacity: prog(frame, ladderAts[i] - 4, 8)}}>›</div>}
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 900,
                    fontSize: size,
                    color: i === ladder.length - 1 ? C.paper : C.dim,
                    opacity: frame >= ladderAts[i] ? 1 : 0,
                    transform: `scale(${slam(frame, ladderAts[i], 2.4)})`,
                    textShadow: i === ladder.length - 1 ? `0 0 40px ${C.gold}88` : undefined,
                  }}
                >
                  {l.text}
                </div>
              </React.Fragment>
            );
          })}
          <div
            style={{
              position: 'absolute',
              left: -30,
              top: '50%',
              height: 16,
              width: `${strike * 112}%`,
              background: C.red,
              transform: 'rotate(-5deg)',
              boxShadow: `0 0 24px ${C.red}`,
            }}
          />
        </div>
        {/* 15年：重击后占据画面中心 */}
        <div style={{position: 'absolute', top: 330, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: Math.min(320, Math.floor(880 / Array.from(String(d.big)).reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.6 : 1), 0))),
            lineHeight: 1.05,
            opacity: frame >= bigAt ? 1 : 0,
            transform: `scale(${slam(frame, bigAt, 3, 9)})`,
            filter: `drop-shadow(0 0 ${40 + 30 * (1 - after)}px ${C.gold}88) drop-shadow(0 14px 20px #000)`,
          }}
        >
          <Shine at={bigAt + 15} every={60}>{d.big}</Shine>
        </div>
        <div style={{fontFamily: DISPLAY, fontSize: 56, color: C.paper, letterSpacing: 8 + (1 - prog(frame, bigAt + 10, 20)) * 20, opacity: prog(frame, bigAt + 10, 15)}}>
          {d.sub}
        </div>
        </div>
        <Ring at={bigAt} x={480} y={640} size={1200} />
        <Ring at={bigAt + 4} x={480} y={640} size={800} color={C.red} />
        <Burst at={bigAt} x={480} y={640} count={60} spread={700} />
      </Content>
      <Flash at={bigAt} strength={0.85} />
    </>
  );
};

/** 竖向时间轴：节点随旁白依次点亮，当前节点放大，旧节点变暗 */
const Timeline: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const items = scene.data.items as {year: string; event: string; cue?: string; danger?: boolean; seal?: string}[];
  const ats = items.map((it, i) => cueFrame(scene, it.cue, i * 3));
  const ROW = 210;
  const AXIS = 360;
  const lineH = ats.slice(1).reduce((h, at) => h + ROW * prog(frame, at - 12, 14), 0);
  const active = ats.reduce((a, at, i) => (frame >= at - 3 ? i : a), 0);
  const dangerIdx = items.findIndex((x) => x.danger);
  const dangerAt = dangerIdx >= 0 ? ats[dangerIdx] : -999;
  return (
    <>
      {ats.map((at, i) => (
        <Sfx key={i} at={at - 2} name={items[i].danger ? 'boom' : 'thump'} volume={items[i].danger ? 0.6 : 0.55} />
      ))}
      {dangerIdx >= 0 && <Sfx at={dangerAt + 12} name="stamp" volume={0.7} />}
      <Content style={{justifyContent: 'center', transform: shake(frame, [dangerAt, dangerAt + 12], 26)}}>
        <div style={{position: 'relative', height: ROW * (items.length - 1) + 120}}>
          <div style={{position: 'absolute', left: AXIS - 3, top: 60, width: 6, height: lineH, background: `linear-gradient(${C.gold}, ${C.red})`, boxShadow: `0 0 18px ${C.gold}`}} />
          {items.map((it, i) => {
            const p = prog(frame, ats[i] - 3, 12);
            const pop = spring({frame: frame - ats[i], fps: FPS, config: {damping: 10}});
            const color = it.danger ? '#ff5a45' : C.gold;
            const isActive = i === active;
            const emph = isActive ? 1 : 0.55;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: i * ROW,
                  left: 0,
                  right: 0,
                  height: 120,
                  opacity: p * emph,
                  transform: `scale(${isActive ? 1.06 : 0.96})`,
                  transformOrigin: `${AXIS}px 60px`,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    right: 1080 - 120 - AXIS + 50,
                    top: 18,
                    fontFamily: DISPLAY,
                    fontWeight: 900,
                    fontSize: 68,
                    color,
                    transform: `translateX(${(1 - p) * -120}px)`,
                    filter: `blur(${(1 - p) * 8}px)`,
                  }}
                >
                  {it.year}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: AXIS - 26,
                    top: 34,
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 0 10px ${color}33, 0 0 ${isActive ? 60 : 20}px ${color}`,
                    transform: `scale(${pop})`,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: AXIS + 60,
                    top: 22,
                    fontFamily: DISPLAY,
                    fontWeight: 700,
                    fontSize: 62,
                    color: it.danger ? '#ff5a45' : C.paper,
                    transform: `translateX(${(1 - p) * 120}px)`,
                    filter: `blur(${(1 - p) * 8}px)`,
                  }}
                >
                  {it.event}
                </div>
                {it.danger && (
                  <Seal
                    text={it.seal ?? '亡'}
                    size={130}
                    style={{
                      position: 'absolute',
                      right: -10,
                      top: -16,
                      opacity: frame >= ats[i] + 12 ? 1 : 0,
                      transform: `rotate(-12deg) scale(${slam(frame, ats[i] + 12, 2.8, 9)})`,
                    }}
                  />
                )}
              </div>
            );
          })}
          {ats.map((at, i) => (
            <Ring key={i} at={at} x={AXIS} y={i * ROW + 60} size={items[i].danger ? 700 : 300} color={items[i].danger ? '#ff5a45' : C.gold} />
          ))}
          {dangerIdx >= 0 && <Burst at={dangerAt + 12} x={900} y={dangerIdx * ROW + 50} color="#ff6a4a" />}
        </div>
      </Content>
      <Flash at={dangerAt} color="#ff2a1a" strength={0.45} dur={14} />
    </>
  );
};

/** 数据条：数字滚动 + 条形扫光 + 人口方格涟漪填充 */
const Stats: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const items = d.items as {num: number; unit: string; name: string; cue?: string}[];
  const max = Math.max(...items.map((x) => x.num));
  const total = items.reduce((a, x) => a + x.num, 0);
  const footAt = cueFrame(scene, d.footerCue, 7);
  const ats = items.map((it, i) => cueFrame(scene, it.cue, 2 + i));
  const pctAt = footAt + 42;
  // 100 格 = 2000 万人，每格 20 万
  const cells = 100;
  const filled = total / 20;
  return (
    <>
      {ats.map((at, i) => (
        <React.Fragment key={i}>
          <Sfx at={at - 3} name="thump" volume={0.6} />
          {Array.from({length: 8}).map((_, k) => (
            <Sfx key={k} at={at + k * 3} name="tick" volume={0.25} />
          ))}
        </React.Fragment>
      ))}
      <Sfx at={footAt} name="whoosh" volume={0.5} />
      <Sfx at={pctAt} name="stamp" volume={0.7} />
      <Content style={{transform: shake(frame, [pctAt], 16)}}>
        <Label text={d.label} />
        {items.map((it, i) => {
          const at = ats[i];
          const p = prog(frame, at - 3, 24);
          const shineX = interpolate(frame, [at + 20, at + 40], [-30, 130], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const enter = prog(frame, at - 3, 10);
          return (
            <div key={i} style={{marginBottom: 18, opacity: enter, transform: `translateX(${(1 - enter) * -160}px)`}}>
              <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
                <div style={{fontFamily: DISPLAY, fontWeight: 700, fontSize: 56, color: C.paper}}>{it.name}</div>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 900,
                    fontSize: 100,
                    color: C.gold,
                    lineHeight: 1,
                    transform: `scale(${1 + Math.max(0, 1 - Math.abs(frame - at - 22) / 6) * 0.15})`,
                    textShadow: `0 0 30px ${C.gold}66`,
                  }}
                >
                  {Math.round(it.num * p)}
                  <span style={{fontSize: 52, marginLeft: 6}}>{it.unit}</span>
                </div>
              </div>
              <div style={{height: 22, background: '#ffffff14', marginTop: 12, borderRadius: 11, overflow: 'hidden'}}>
                <div
                  style={{
                    height: '100%',
                    width: `${(it.num / max) * 100 * p}%`,
                    borderRadius: 11,
                    background: `linear-gradient(90deg, ${C.redDeep}, ${C.red}, ${C.gold})`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{position: 'absolute', top: 0, bottom: 0, left: `${shineX}%`, width: '25%', background: 'linear-gradient(90deg, transparent, #fff9, transparent)'}} />
                </div>
              </div>
            </div>
          );
        })}
        <div style={{marginTop: 14, opacity: prog(frame, footAt - 3, 12)}}>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, width: 960}}>
            {Array.from({length: cells}).map((_, i) => {
              const col = i % 25;
              const row = Math.floor(i / 25);
              const ripple = footAt + 8 + (col + row) * 1.2;
              const lit = Math.max(0, Math.min(1, filled - i)) * prog(frame, footAt + 10 + i * 0.8, 8);
              const wave = Math.max(0, 1 - Math.abs(frame - ripple) / 6);
              return (
                <div
                  key={i}
                  style={{
                    width: 32.4,
                    height: 32,
                    background: `rgba(255,255,255,${0.09 + wave * 0.25})`,
                    position: 'relative',
                    borderRadius: 4,
                    transform: `scale(${1 + wave * 0.25})`,
                  }}
                >
                  <div style={{position: 'absolute', inset: 0, width: `${lit * 100}%`, background: C.red, borderRadius: 4, boxShadow: lit > 0 ? `0 0 12px ${C.red}` : undefined}} />
                </div>
              );
            })}
          </div>
          <div style={{marginTop: 14, fontFamily: SANS, fontSize: 38, color: C.dim}}>{d.footer} · 每格 20 万人</div>
          <div
            style={{
              marginTop: 10,
              textAlign: 'center',
              fontFamily: SANS,
              fontWeight: 900,
              fontSize: 54,
              color: '#ff6a55',
              textShadow: '0 0 24px #ff3a2088',
              opacity: frame >= pctAt ? 1 : 0,
              transform: `scale(${slam(frame, pctAt, 2)})`,
            }}
          >
            服役 ≈ {total} 万 · 占 {((total / 2000) * 100).toFixed(1)}%
          </div>
        </div>
      </Content>
    </>
  );
};

/** 古文引用：墨迹晕开 + 逐字落笔 + 盖章 */
const Quote: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const at = cueFrame(scene, d.cue, 3);
  const lines = (d.quote as string).split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.min(150, Math.floor(860 / longest));
  const totalChars = lines.join('').length;
  const step = 4;
  const doneAt = at + totalChars * step + 6;
  const ink = prog(frame, at - 8, 40);
  const isSummary = String(d.label).includes('总结');
  let k = 0;
  return (
    <>
      <Sfx at={at - 8} name="whoosh" volume={0.6} />
      {d.stamp && <Sfx at={doneAt} name="stamp" volume={0.7} />}
      {d.stamp && <Sfx at={doneAt} name="thump" volume={0.5} />}
      <Content style={{transform: shake(frame, d.stamp ? [doneAt] : [], 22)}}>
        <Label text={d.label} />
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative'}}>
          {/* 墨迹晕染 */}
          <svg width={1100} height={760} style={{position: 'absolute', left: -70, top: 0, opacity: 0.8 * ink}}>
            <filter id="inkblot">
              <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed={isSummary ? 4 : 2} />
              <feDisplacementMap in="SourceGraphic" scale={120} />
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <ellipse cx={550} cy={330} rx={260 + ink * 260} ry={130 + ink * 130} fill={isSummary ? '#2a1d12' : '#3a0d09'} filter="url(#inkblot)" />
          </svg>
          <div style={{fontFamily: DISPLAY, fontSize: 140, color: C.gold, opacity: 0.5 * prog(frame, at - 10, 10), alignSelf: 'flex-start', lineHeight: 0.6, position: 'relative'}}>「</div>
          {lines.map((line, li) => (
            <div key={li} style={{fontFamily: DISPLAY, fontWeight: 900, fontSize: size, color: C.paper, lineHeight: 1.35, letterSpacing: 8, position: 'relative'}}>
              {Array.from(line).map((ch) => {
                const cAt = at + k++ * step;
                const p = prog(frame, cAt, 9);
                return (
                  <span
                    key={k}
                    style={{
                      opacity: p,
                      filter: `blur(${(1 - p) * 18}px)`,
                      display: 'inline-block',
                      transform: `scale(${1.8 - 0.8 * p})`,
                      textShadow: `0 0 ${(1 - p) * 40 + 10}px ${isSummary ? '#d9ad5c66' : '#ff3a2066'}`,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
          ))}
          <div style={{fontFamily: DISPLAY, fontSize: 140, color: C.gold, opacity: 0.5 * prog(frame, doneAt - 6, 10), alignSelf: 'flex-end', lineHeight: 0.6, position: 'relative'}}>」</div>
          <div style={{fontFamily: DISPLAY, fontSize: 48, color: C.dim, marginTop: 50, alignSelf: 'flex-end', opacity: prog(frame, doneAt, 12), transform: `translateX(${(1 - prog(frame, doneAt, 12)) * 60}px)`}}>
            —— {d.source}
          </div>
          {d.stamp && (
            <>
              <Seal
                text={d.stamp}
                size={170}
                style={{
                  position: 'absolute',
                  left: 20,
                  bottom: 0,
                  opacity: frame >= doneAt ? 0.95 : 0,
                  transform: `rotate(-10deg) scale(${slam(frame, doneAt, 2.8, 9)})`,
                }}
              />
              <Burst at={doneAt} x={105} y={600} color="#c9b08a" count={28} spread={260} />
            </>
          )}
        </div>
      </Content>
    </>
  );
};

/** 按卡片宽度给一行文字算字号：中文按 1 个字宽、英文数字按 0.6 个字宽估算，保证不换行 */
const fitFont = (text: string, boxWidth: number, maxSize: number, spacing: number) => {
  const chars = Array.from(text);
  const em = chars.reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.6 : 1), 0);
  return Math.min(maxSize, Math.floor((boxWidth - 70 - spacing * chars.length) / em));
};

/** 因果链：卡片逐个砸下，画面越来越红，最后一张故障闪烁 */
const Chain: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const steps = d.steps as {text: string; cue?: string}[];
  const ats = steps.map((s, i) => cueFrame(scene, s.cue, 2 + i * 2));
  const lastAt = ats[ats.length - 1];
  const compact = steps.length >= 5;
  const heatNow = ats.reduce((h, at, i) => h + prog(frame, at, 20) / steps.length, 0);
  return (
    <>
      <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 50%, rgba(140,10,5,${heatNow * 0.45}) 0%, transparent 70%)`}} />
      {ats.map((at, i) => (
        <Sfx key={i} at={at - 2} name={i === steps.length - 1 ? 'boom' : 'thump'} volume={0.55 + i * 0.1} />
      ))}
      <Content style={{transform: shake(frame, ats, 10) + ' ' + shake(frame, [lastAt], 30)}}>
        <Label text={d.label} />
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative'}}>
          {steps.map((s, i) => {
            const at = ats[i];
            const p = prog(frame, at - 3, 10);
            const heat = i / (steps.length - 1);
            const last = i === steps.length - 1;
            const glitch = last && frame >= at && frame < at + 14 ? (frame % 3) - 1 : 0;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div style={{width: 6, height: (compact ? 26 : 44) * prog(frame, at - 8, 6), background: `linear-gradient(${C.gold}, ${C.red})`, margin: '0 auto'}} />
                )}
                <div
                  style={{
                    width: last ? 780 : 680,
                    height: compact ? (last ? 108 : 86) : last ? 128 : 104,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: DISPLAY,
                    fontWeight: 900,
                    fontSize: fitFont(s.text, last ? 780 : 680, compact ? (last ? 66 : 52) : last ? 76 : 60, 10),
                    whiteSpace: 'nowrap',
                    letterSpacing: 10,
                    color: '#f7e9d8',
                    background: `linear-gradient(90deg, rgba(110,20,15,${0.35 + heat * 0.5}), rgba(184,40,31,${0.4 + heat * 0.6}))`,
                    border: `2px solid ${last ? C.gold : '#ffffff22'}`,
                    borderRadius: 14,
                    boxShadow: last ? `0 0 ${50 + Math.sin(frame / 4) * 20}px ${C.red}` : '0 10px 30px #0008',
                    opacity: frame >= at - 3 ? 1 : 0,
                    transform: `scale(${slam(frame, at - 3, last ? 2.2 : 1.5, 12)}) translateX(${glitch * 12}px)`,
                    textShadow: glitch ? `${glitch * 8}px 0 #00e5ff, ${-glitch * 8}px 0 #ff2a55` : '0 4px 10px #000',
                    filter: `blur(${(1 - p) * 6}px)`,
                  }}
                >
                  {s.text}
                </div>
              </React.Fragment>
            );
          })}
          <Burst at={lastAt} x={480} y={680} color="#ff5a3a" count={50} spread={600} />
          <Ring at={lastAt} x={480} y={680} color="#ff3a2a" size={1100} />
        </div>
      </Content>
      <Flash at={lastAt} color="#ff1a0a" strength={0.55} dur={14} />
    </>
  );
};

/** 结尾：下期预告 + 旋转光芒 + 关注按钮 */
const Outro: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const titleAt = cueFrame(scene, d.titleCue, 1);
  const followAt = cueFrame(scene, d.followCue, 5);
  const pulse = 1 + Math.max(0, Math.sin((frame - followAt) / 4)) * 0.07 * (frame > followAt + 12 ? 1 : 0);
  const titleP = prog(frame, titleAt - 3, 15);
  return (
    <>
      <Sfx at={titleAt - 3} name="whoosh" volume={0.6} />
      <Sfx at={followAt} name="pop" />
      <Content style={{alignItems: 'center', justifyContent: 'center'}}>
        <Label text={d.next} />
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 92,
            lineHeight: 1.35,
            color: C.paper,
            textAlign: 'center',
            maxWidth: 860,
            opacity: titleP,
            filter: `blur(${(1 - titleP) * 10}px)`,
            transform: `translateY(${(1 - titleP) * 60}px) scale(${1.1 - titleP * 0.1})`,
          }}
        >
          <Shine at={titleAt + 15} every={80} color={C.paper}>{d.title}</Shine>
        </div>
        <div style={{position: 'relative', marginTop: 100}}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 700,
              height: 700,
              marginLeft: -350,
              marginTop: -350,
              borderRadius: '50%',
              background: 'repeating-conic-gradient(#ffb34d22 0deg 8deg, transparent 8deg 20deg)',
              transform: `rotate(${frame * 0.8}deg) scale(${prog(frame, followAt, 20)})`,
              maskImage: 'radial-gradient(circle, #000 20%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(circle, #000 20%, transparent 70%)',
            }}
          />
          <div
            style={{
              position: 'relative',
              padding: '26px 90px',
              borderRadius: 80,
              background: 'linear-gradient(90deg, #ff3b5c, #ff6a3d)',
              fontFamily: SANS,
              fontWeight: 900,
              fontSize: 60,
              color: '#fff',
              boxShadow: '0 10px 40px #ff3b5c77',
              opacity: frame >= followAt ? 1 : 0,
              transform: `scale(${slam(frame, followAt, 0.2, 8) * pulse})`,
            }}
          >
            ＋ 关注
          </div>
          <Ring at={followAt} x={250} y={60} color="#ff6a3d" size={600} />
        </div>
      </Content>
    </>
  );
};

/** 冠军墙：S1~S16 全部格子常驻，每个场景点亮一段（range），之前的保持点亮，之后的显示问号；底部按赛区实时计数 */
type WallItem = {tag: string; year: string; team: string; region: string};
const Wall: React.FC<P> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const items = (THEME.wall ?? []) as WallItem[];
  const [from, to] = (d.range ?? [0, items.length]) as [number, number];
  const cues = (d.cues ?? {}) as Record<string, string>;
  const hl = new Set<number>(d.highlight ?? []);
  const step = d.step ?? 6;
  // 每格的点亮帧：有 cue 用 cue，否则紧跟上一格 step 帧后点亮
  let prev = cueFrame(scene, d.cue, 0.6) - step;
  const ats = items.map((_, i) => {
    if (i < from) return -999;
    if (i >= to) return 1e9;
    prev = cues[i] ? cueFrame(scene, cues[i], 1) : prev + step;
    return prev;
  });
  const regions = THEME.regions ?? {};
  const COLS = 4;
  const GAP = 14;
  const cw = (960 - GAP * (COLS - 1)) / COLS;
  const counts: Record<string, number> = {};
  items.forEach((it, i) => {
    if (frame >= ats[i]) counts[it.region] = (counts[it.region] ?? 0) + 1;
  });
  return (
    <>
      {items.map((_, i) =>
        i >= from && i < to ? <Sfx key={i} at={ats[i]} name={hl.has(i) ? 'thump' : 'tick'} volume={hl.has(i) ? 0.6 : 0.5} /> : null,
      )}
      <Content style={{transform: shake(frame, ats.filter((_, i) => hl.has(i)), 12)}}>
        <Label text={d.label} />
        <div style={{display: 'flex', flexWrap: 'wrap', gap: GAP}}>
          {items.map((it, i) => {
            const lit = frame >= ats[i];
            const old = i < from;
            const p = old ? 1 : prog(frame, ats[i], 10);
            const color = regions[it.region] ?? C.gold;
            const big = hl.has(i) && !old;
            const pop = big ? slam(frame, ats[i], 1.6, 10) : 1;
            return (
              <div
                key={i}
                style={{
                  width: cw,
                  height: 100,
                  borderRadius: 12,
                  border: `2px solid ${lit ? color : '#ffffff22'}`,
                  background: lit ? `linear-gradient(160deg, ${color}${old ? '22' : '44'}, #00000066)` : '#ffffff08',
                  boxShadow: lit && !old ? `0 0 ${big ? 40 : 18}px ${color}88` : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: old ? 0.55 : lit ? 0.4 + 0.6 * p : 0.45,
                  transform: `scale(${lit ? pop : 1})`,
                  position: 'relative',
                  zIndex: big ? 2 : 1,
                }}
              >
                <div style={{fontFamily: SANS, fontSize: 24, color: lit ? C.dim : '#ffffff55', letterSpacing: 2}}>
                  {it.tag} · {it.year}
                </div>
                <div style={{fontFamily: DISPLAY, fontWeight: 900, fontSize: it.team.length > 4 ? 36 : 44, color: lit ? '#fff' : '#ffffff44', marginTop: 2}}>
                  {lit ? it.team : '?'}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display: 'flex', justifyContent: 'center', gap: 34, marginTop: 22}}>
          {Object.entries(regions).map(([r, color]) => (
            <div key={r} style={{fontFamily: SANS, fontWeight: 900, fontSize: 40, color, opacity: counts[r] ? 1 : 0.35}}>
              {r} <span style={{color: '#fff'}}>×{counts[r] ?? 0}</span>
            </div>
          ))}
        </div>
      </Content>
    </>
  );
};

export const SCENES: Record<string, React.FC<P>> = {
  hook: Hook,
  timeline: Timeline,
  stats: Stats,
  quote: Quote,
  chain: Chain,
  outro: Outro,
  wall: Wall,
  shot: ShotScene,
  stage: StageScene,
};
