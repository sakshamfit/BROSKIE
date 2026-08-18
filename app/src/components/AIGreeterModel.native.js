import React, { Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL = require('../../assets/ai-greeter.glb');

function parseGLB(buffer, resourcePath = '') {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(buffer, resourcePath, resolve, reject);
  });
}

/** Resolve Metro's numeric asset into bytes before giving it to Three.js. */
function useNativeGLTF() {
  const [gltf, setGltf] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const asset = Asset.fromModule(MODEL);
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        if (!uri) throw new Error('The AI character asset has no local URI');

        let buffer;
        if (/^https?:/i.test(uri)) {
          const response = await fetch(uri);
          if (!response.ok) throw new Error(`AI character download failed (${response.status})`);
          buffer = await response.arrayBuffer();
        } else {
          const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          const bytes = toByteArray(base64);
          buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
        const resourcePath = uri.slice(0, Math.max(0, uri.lastIndexOf('/') + 1));
        const parsed = await parseGLB(buffer, resourcePath);
        if (active) setGltf(parsed);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
      }
    })();
    return () => { active = false; };
  }, []);

  if (error) throw error;
  return gltf;
}

/** Load and continuously play the animation exactly as exported in the GLB. */
function Character({ horizontalOffset, gltf }) {
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
    <group position={[horizontalOffset, -0.15, 0]}>
      <group scale={normalized.scale} position={normalized.position}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

export default function AIGreeterModel({ horizontalOffset = 0, style }) {
  const gltf = useNativeGLTF();
  if (!gltf) {
    return (
      <View style={[{ flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' }, style]}>
        <ActivityIndicator size="small" color="#f4f0ef" />
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, minHeight: 260 }, style]}>
      <Canvas
        camera={{ position: [0, 0.12, 5.8], fov: 33 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={2.1} />
        <directionalLight position={[3, 4, 5]} intensity={2.5} />
        <directionalLight position={[-3, 1, 2]} intensity={0.8} />
        <Suspense fallback={null}>
          <Character horizontalOffset={horizontalOffset} gltf={gltf} />
        </Suspense>
      </Canvas>
    </View>
  );
}
