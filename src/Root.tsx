import React from 'react';
import {Composition, Still} from 'remotion';
import {TIMELINE} from './lib';
import {CastSheet} from './CastSheet';
import {RigTest} from './RigTest';
import {MeshDemo} from './MeshDemo';
import {MeshTest} from './MeshTest';
import {PoseGuide} from './PoseGuide';
import {SpriteDemo} from './SpriteDemo';
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
    <Still id="PoseGuide" component={PoseGuide} width={832} height={1216} defaultProps={{id: 'ryoji_kid', pose: 'stand'}} />
    <Still id="MeshTest" component={MeshTest} width={1080} height={1920} />
    <Composition id="SpriteDemo" component={SpriteDemo} durationInFrames={330} fps={30} width={1080} height={1920} />
    <Composition id="MeshDemo" component={MeshDemo} durationInFrames={330} fps={30} width={1080} height={1920} />
    </>
);
