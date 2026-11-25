import React from 'react';
import {AbsoluteFill} from 'remotion';
import cast from '../videos/byakuya/cast.json';
import {CharSpec, Chibi, ChibiState} from './chibi';
import {SANS} from './lib';

/** 演员表预览：每个角色展示一种代表性状态 */
const DEMO: Record<string, ChibiState> = {
  ryoji_kid: {expr: 'dark', pose: 'hold'},
  yukiho_kid: {expr: 'smile', pose: 'idle', prop: 'book'},
  sasagaki: {expr: 'thinking', pose: 'think', emote: '?'},
  yosuke: {expr: 'normal', pose: 'idle', prop: 'money'},
  fumiyo: {expr: 'sad', pose: 'idle', emote: 'sweat'},
  terasaki: {expr: 'shocked', pose: 'shock', emote: '!'},
  reiko: {expr: 'smile', pose: 'wave'},
  yukiho: {expr: 'cold', pose: 'idle'},
  ryoji: {expr: 'dark', pose: 'idle', emote: 'dark'},
};

export const CastSheet: React.FC = () => (
  <AbsoluteFill style={{background: 'linear-gradient(#1c1f33, #0d0f1a)', padding: 40}}>
    <div style={{fontFamily: SANS, fontWeight: 900, fontSize: 64, color: '#fff', textAlign: 'center', marginTop: 40}}>《白夜行》演员表</div>
    <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '30px 10px', marginTop: 40}}>
      {Object.entries(cast as Record<string, CharSpec>).map(([id, spec], i) => (
        <div key={id} style={{width: 320, display: 'flex', justifyContent: 'center'}}>
          <Chibi spec={spec} state={DEMO[id]} size={430} seed={i} />
        </div>
      ))}
    </div>
  </AbsoluteFill>
);
