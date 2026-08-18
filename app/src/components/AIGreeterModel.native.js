import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Canvas, useFrame, useLoader } from '@react-three/fiber/native';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL = require('../../assets/ai-greeter.glb');

const BASE_POSE = {
  LeftShoulder: [0, 0, 0], RightShoulder: [0, 0, 0],
  // Avaturn upper-arm bones point along local +Y. Local X rotation lowers
  // them from the exported T-pose into a natural resting position.
  LeftArm: [1.08, 0, 0], RightArm: [1.08, 0, 0],
  LeftForeArm: [0, 0, 0], RightForeArm: [0, 0, 0],
  LeftHand: [0, 0, 0], RightHand: [0, 0, 0],
  Head: [0, 0, 0], Spine1: [0, 0, 0], Spine2: [0, 0, 0],
};

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
  const rig = useMemo(() => {
    const bones = {};
    model.traverse((object) => {
      if (object.isBone && BASE_POSE[object.name]) {
        bones[object.name] = { bone: object, base: object.quaternion.clone() };
      }
    });
    return bones;
  }, [model]);
  const hasRealAnimation = useMemo(() => animations.some((clip) =>
    clip.duration > 0.2 && clip.tracks.some((track) => (track.times?.length || 0) > 1)
  ), [animations]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);

  useEffect(() => {
    const find = (pattern) => animations.find((clip) => pattern.test(clip.name));
    const idle = find(/idle|breath|loop/i);
    const wave = find(/wave|greet|hello/i);
    const talk = find(/talk|speak|voice|mouth/i);
    mixer.stopAllAction();
    let chosen;
    if (talking) chosen = talk || idle;
    else if (!waved.current && wave) { chosen = wave; waved.current = true; }
    else chosen = idle;
    const action = chosen ? mixer.clipAction(chosen, model) : null;
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
    };
  }, [animations, mixer, model, talking]);

  useFrame((state, delta) => {
    mixer.update(delta);
    if (!root.current) return;
    const time = state.clock.getElapsedTime();

    if (!hasRealAnimation) {
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
      const blend = Math.min(1, delta * 7.5);
      Object.entries(pose).forEach(([name, rotation]) => {
        const entry = rig[name];
        if (!entry) return;
        const deltaRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
        const target = entry.base.clone().multiply(deltaRotation);
        entry.bone.quaternion.slerp(target, blend);
      });
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
      <Canvas
        camera={{ position: [0, 0.18, 3.25], fov: 34 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
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
