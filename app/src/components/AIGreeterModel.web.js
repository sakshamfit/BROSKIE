import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL = require('../../assets/ai-greeter.glb');

function Character({ talking }) {
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
    root.current.position.y = Math.sin(time * 1.45) * 0.045;
    root.current.rotation.y = Math.sin(time * 0.55) * 0.1;
    const pulse = talking ? 1 + Math.sin(time * 11) * 0.012 : 1;
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

export default function AIGreeterModel({ talking = false, style }) {
  return (
    <View style={[{ flex: 1, minHeight: 260 }, style]}>
      <Canvas camera={{ position: [0, 0.15, 4.1], fov: 34 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={2.1} />
        <directionalLight position={[3, 4, 5]} intensity={2.5} />
        <directionalLight position={[-3, 1, 2]} intensity={0.8} />
        <Suspense fallback={null}>
          <Character talking={talking} />
        </Suspense>
      </Canvas>
    </View>
  );
}
