import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BASE_POSE, applyRigPose, discoverGreeterRig } from './AIGreeterRig';

const MODEL = require('../../assets/ai-greeter.glb');

function Character({ talking, gesture, horizontalOffset }) {
  const root = useRef();
  const waved = useRef(false);
  const { scene, animations = [] } = useLoader(GLTFLoader, MODEL);
  const model = useMemo(() => clone(scene), [scene]);
  const normalized = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.55 / Math.max(size.x || 1, size.y || 1, size.z || 1);
    return { scale, position: [-center.x * scale, -center.y * scale - 0.05, -center.z * scale] };
  }, [model]);
  const rigInfo = useMemo(() => discoverGreeterRig(model), [model]);
  const rig = rigInfo.rig;
  const usingClip = useRef(false);

  // Set a natural pose before the first rendered frame so no naming variant
  // can flash or remain in the exported T-pose.
  useLayoutEffect(() => {
    applyRigPose(rig, BASE_POSE, 1);
  }, [rig]);

  useEffect(() => {
    const mapped = Object.fromEntries(Object.entries(rig).map(([role, entry]) => [role, entry.sourceName]));
    const missing = Object.keys(BASE_POSE).filter((role) => !rig[role]);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[AI Greeter] animations:', animations.map((clip) => ({ name: clip.name, duration: clip.duration })));
      console.info('[AI Greeter] bone map:', mapped);
    }
    if (missing.length) {
      console.warn('[AI Greeter] missing semantic bones:', missing, 'available:', rigInfo.allBoneNames);
    }
  }, [animations, rig, rigInfo.allBoneNames]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);

  useEffect(() => {
    const find = (pattern) => animations.find((clip) => pattern.test(clip.name));
    const idle = find(/idle|breath|loop/i);
    const wave = find(/wave|greet|hello/i);
    const talk = find(/talk|speak|voice|mouth/i);
    mixer.stopAllAction();
    let chosen;
    if (gesture === 'wave' && !waved.current && wave) { chosen = wave; waved.current = true; }
    else if (talking && talk) chosen = talk;
    else if (gesture === 'idle') chosen = idle;
    const action = chosen ? mixer.clipAction(chosen, model) : null;
    usingClip.current = !!action;
    if (action) {
      action.reset().fadeIn(0.18);
      if (!talking && chosen === wave) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
    }
    return () => {
      action?.fadeOut?.(0.15);
      mixer.stopAllAction();
      usingClip.current = false;
    };
  }, [animations, gesture, mixer, model, talking]);

  useFrame((state, delta) => {
    mixer.update(delta);
    if (!root.current) return;
    const time = state.clock.getElapsedTime();

    // The uploaded Avaturn model currently exposes one generic clip named
    // Action.004. Generic clips cannot be mapped to speech semantics, so the
    // skeleton controller takes over unless a recognised Wave/Talk/Idle clip
    // is available for the current phase.
    if (!usingClip.current) {
      const pose = { ...BASE_POSE };
      if (gesture === 'wave') {
        pose.RightArm = [-1.02, 0, 0.08];
        pose.RightForeArm = [-1.18, 0, -0.18];
        pose.RightHand = [0, Math.sin(time * 8) * 0.52, 0.18];
        pose.Head = [0, -0.16, -0.08];
      } else if (gesture === 'weather') {
        pose.RightArm = [0.12, -0.12, 0.1];
        pose.RightForeArm = [-0.48, -0.18, -0.12];
        pose.RightHand = [0, -0.2, 0.12];
        pose.Head = [Math.sin(time * 3.2) * 0.045, -0.18, 0];
        pose.Spine2 = [0, -0.08, -0.03];
      } else if (gesture === 'notify') {
        pose.LeftArm = [0.62, 0.12, -0.08];
        pose.RightArm = [0.62, -0.12, 0.08];
        pose.LeftForeArm = [-0.95 + Math.sin(time * 4) * 0.1, -0.18, -0.18];
        pose.RightForeArm = [-0.95 + Math.sin(time * 4) * 0.1, 0.18, 0.18];
        pose.Head = [Math.sin(time * 4.5) * 0.06, 0, 0];
      } else if (gesture === 'final') {
        pose.LeftArm = [0.48, 0, -0.08];
        pose.RightArm = [0.48, 0, 0.08];
        pose.LeftForeArm = [-0.35, -0.12, -0.12];
        pose.RightForeArm = [-0.35, 0.12, 0.12];
        pose.Head = [-0.05, 0, Math.sin(time * 2.6) * 0.05];
        pose.Spine1 = [0, 0, 0.04];
      }
      if (talking) {
        pose.Head = [
          (pose.Head?.[0] || 0) + Math.sin(time * 6.2) * 0.035,
          pose.Head?.[1] || 0,
          (pose.Head?.[2] || 0) + Math.sin(time * 3.1) * 0.025,
        ];
        pose.Spine2 = [Math.sin(time * 4.2) * 0.018, pose.Spine2?.[1] || 0, pose.Spine2?.[2] || 0];
      }
      applyRigPose(rig, pose, Math.min(1, delta * 7.5));
    }

    root.current.position.x = horizontalOffset;
    root.current.position.y = -0.28 + Math.sin(time * 1.45) * 0.032;
    root.current.rotation.y = Math.sin(time * 0.55) * 0.045;
    const pulse = talking ? 1 + Math.sin(time * 9) * 0.008 : 1;
    root.current.scale.setScalar(pulse);
  });

  return (
    <group ref={root}>
      <group scale={normalized.scale} position={normalized.position}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export default function AIGreeterModel({ talking = false, gesture = 'idle', horizontalOffset = 0, style }) {
  return (
    <View style={[{ flex: 1, minHeight: 260 }, style]}>
      <Canvas camera={{ position: [0, 0.18, 3.25], fov: 34 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={2.1} />
        <directionalLight position={[3, 4, 5]} intensity={2.5} />
        <directionalLight position={[-3, 1, 2]} intensity={0.8} />
        <Suspense fallback={null}>
          <Character talking={talking} gesture={gesture} horizontalOffset={horizontalOffset} />
        </Suspense>
      </Canvas>
    </View>
  );
}
