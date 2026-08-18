import React, { Suspense, useLayoutEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL = require('../../assets/ai-greeter.glb');

/** Load and continuously play the animation exactly as exported in the GLB. */
function Character({ horizontalOffset }) {
  const gltf = useLoader(GLTFLoader, MODEL);
  const { scene, animations = [] } = gltf;
  const normalized = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.55 / Math.max(size.x || 1, size.y || 1, size.z || 1);
    return { scale, position: [-center.x * scale, -center.y * scale - 0.05, -center.z * scale] };
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const clip = useMemo(() => {
    if (animations.length === 1) return animations[0];
    return animations.find((item) => item.name === 'Action.004') || animations[0] || null;
  }, [animations]);

  useLayoutEffect(() => {
    console.info('[AI Greeter] Original GLB animations:', animations.map((item) => ({ name: item.name, duration: item.duration })));
    if (!clip) {
      console.warn('[AI Greeter] The GLB contains no animation clips.');
      return undefined;
    }
    const action = mixer.clipAction(clip, scene);
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    return () => {
      action.stop();
      mixer.stopAllAction();
      mixer.uncacheAction(clip, scene);
    };
  }, [animations, clip, mixer, scene]);

  useFrame((_, delta) => mixer.update(delta));

  return (
    <group position={[horizontalOffset, -0.4, 0]}>
      <group scale={normalized.scale} position={normalized.position}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

export default function AIGreeterModel({ horizontalOffset = 0, style }) {
  return (
    <View style={[{ flex: 1, minHeight: 260 }, style]}>
      <Canvas camera={{ position: [0, 0.2, 2.9], fov: 33 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={2.1} />
        <directionalLight position={[3, 4, 5]} intensity={2.5} />
        <directionalLight position={[-3, 1, 2]} intensity={0.8} />
        <Suspense fallback={null}>
          <Character horizontalOffset={horizontalOffset} />
        </Suspense>
      </Canvas>
    </View>
  );
}
