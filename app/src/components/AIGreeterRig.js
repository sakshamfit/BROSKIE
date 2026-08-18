import * as THREE from 'three';

/** Natural Avaturn resting offsets, always multiplied onto the GLB bind pose. */
export const BASE_POSE = {
  LeftArm: [1.08, 0, 0], RightArm: [1.08, 0, 0],
  LeftForeArm: [0, 0, 0], RightForeArm: [0, 0, 0],
  LeftHand: [0, 0, 0], RightHand: [0, 0, 0],
  Head: [0, 0, 0], Spine1: [0, 0, 0], Spine2: [0, 0, 0],
};

const ALIASES = {
  LeftArm: ['leftarm', 'leftupperarm', 'upperarml', 'lupperarm', 'arml'],
  RightArm: ['rightarm', 'rightupperarm', 'upperarmr', 'rupperarm', 'armr'],
  LeftForeArm: ['leftforearm', 'leftlowerarm', 'forearml', 'lforearm', 'lowerarml'],
  RightForeArm: ['rightforearm', 'rightlowerarm', 'forearmr', 'rforearm', 'lowerarmr'],
  LeftHand: ['lefthand', 'handl', 'lhand'],
  RightHand: ['righthand', 'handr', 'rhand'],
  Head: ['head', 'headbone'],
  Spine1: ['spine1', 'spine01', 'chest', 'lowerchest'],
  Spine2: ['spine2', 'spine02', 'upperchest', 'chest2'],
};

export const normalizeBoneName = (name) => String(name || '')
  .toLowerCase()
  .replace(/mixamorig[:_.-]?/g, '')
  .replace(/armature[:_.-]?/g, '')
  .replace(/[^a-z0-9]/g, '');

/** Map common Avaturn/Mixamo/Blender naming variants to semantic roles. */
export function semanticBoneRole(name) {
  const normalized = normalizeBoneName(name);
  if (!normalized) return null;

  // Exact aliases first; order prevents LeftArm from swallowing LeftForeArm.
  for (const role of ['LeftForeArm', 'RightForeArm', 'LeftArm', 'RightArm', 'LeftHand', 'RightHand', 'Spine2', 'Spine1', 'Head']) {
    if (ALIASES[role].includes(normalized)) return role;
  }

  const left = normalized.includes('left') || normalized.startsWith('l') || normalized.endsWith('l');
  const right = normalized.includes('right') || normalized.startsWith('r') || normalized.endsWith('r');
  const forearm = normalized.includes('forearm') || normalized.includes('lowerarm');
  const upperArm = normalized.includes('upperarm') || (normalized.includes('arm') && !forearm);
  const hand = normalized.includes('hand') && !/(thumb|index|middle|ring|pinky|finger|\d)/.test(normalized);

  if (forearm && left && !right) return 'LeftForeArm';
  if (forearm && right && !left) return 'RightForeArm';
  if (upperArm && left && !right) return 'LeftArm';
  if (upperArm && right && !left) return 'RightArm';
  if (hand && left && !right) return 'LeftHand';
  if (hand && right && !left) return 'RightHand';
  if (normalized === 'upperchest' || /spine0?2$/.test(normalized)) return 'Spine2';
  if (normalized === 'chest' || normalized === 'lowerchest' || /spine0?1$/.test(normalized)) return 'Spine1';
  if (normalized === 'head' || normalized.endsWith('headbone')) return 'Head';
  return null;
}

/** Discover a rig while preserving each matched bone's original bind quaternion. */
export function discoverGreeterRig(model) {
  const rig = {};
  const allBoneNames = [];
  model.traverse((object) => {
    if (!object.isBone) return;
    allBoneNames.push(object.name || '(unnamed)');
    const role = semanticBoneRole(object.name);
    if (role && !rig[role]) {
      rig[role] = {
        bone: object,
        base: object.quaternion.clone(),
        sourceName: object.name,
      };
    }
  });
  return { rig, allBoneNames };
}

/** Smoothly apply semantic Euler offsets without ever replacing the bind pose. */
export function applyRigPose(rig, pose, blend = 1) {
  Object.entries(pose).forEach(([role, rotation]) => {
    const entry = rig[role];
    if (!entry) return;
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    const target = entry.base.clone().multiply(delta);
    if (blend >= 1) entry.bone.quaternion.copy(target);
    else entry.bone.quaternion.slerp(target, Math.max(0, Math.min(1, blend)));
  });
}
