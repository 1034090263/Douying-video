import React from 'react';
import {Composition, Still} from 'remotion';
import {TIMELINE} from './lib';
import {CastSheet} from './CastSheet';
import {RigTest} from './RigTest';
import {Cover, Story} from './Story';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Story"
      component={Story}
      width={1080}
      height={1920}
      fps={TIMELINE.fps}
      durationInFrames={TIMELINE.scenes.reduce((a, s) => a + s.durationInFrames, 0)}
    />
    <Still id="Cover" component={Cover} width={1080} height={1920} />
    <Still id="CastSheet" component={CastSheet} width={1080} height={1920} />
    <Still id="RigTest" component={RigTest} width={1080} height={1920} />
  </>
);
