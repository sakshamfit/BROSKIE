#!/usr/bin/env python3
"""Generate the replaceable +one AI greeter placeholder GLB.

Users can overwrite app/assets/ai-greeter.glb with their animated character;
the app auto-detects Idle, Wave/Greet and Talk/Speak animation clip names.
"""
from pathlib import Path
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'app' / 'assets' / 'ai-greeter.glb'
scene = trimesh.Scene()

WHITE = [244, 240, 239, 255]
INK = [22, 22, 22, 255]
YELLOW = [255, 226, 77, 255]
GRAPHITE = [88, 88, 86, 255]


def paint(mesh, color):
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=color)
    return mesh


def add(name, mesh, xyz=(0, 0, 0), rotation=None):
    matrix = np.eye(4)
    if rotation is not None:
        matrix = trimesh.transformations.rotation_matrix(rotation[0], rotation[1])
    matrix[:3, 3] = xyz
    scene.add_geometry(mesh, node_name=name, geom_name=name, transform=matrix)

# Paper robot body and head.
add('body', paint(trimesh.creation.box((1.15, 1.35, 0.48)), WHITE), (0, 0.15, 0))
add('body_ink_panel', paint(trimesh.creation.box((0.82, 0.45, 0.51)), INK), (0, 0.15, 0.02))
add('accent', paint(trimesh.creation.box((0.58, 0.08, 0.535)), YELLOW), (0, 0.04, 0.03))
add('head', paint(trimesh.creation.uv_sphere(radius=0.61, count=[20, 14]), WHITE), (0, 1.18, 0))
add('left_eye', paint(trimesh.creation.uv_sphere(radius=0.075, count=[12, 8]), INK), (-0.22, 1.28, 0.54))
add('right_eye', paint(trimesh.creation.uv_sphere(radius=0.075, count=[12, 8]), INK), (0.22, 1.28, 0.54))
add('smile', paint(trimesh.creation.box((0.27, 0.035, 0.04)), GRAPHITE), (0, 1.02, 0.575), (0.05, [0, 0, 1]))

# Limbs; right arm is raised as a built-in visual wave pose.
add('left_arm', paint(trimesh.creation.cylinder(radius=0.11, height=0.95, sections=16), GRAPHITE), (-0.74, 0.35, 0), (0.18, [0, 0, 1]))
add('right_arm_wave', paint(trimesh.creation.cylinder(radius=0.11, height=1.08, sections=16), GRAPHITE), (0.72, 0.75, 0), (-0.78, [0, 0, 1]))
add('wave_hand', paint(trimesh.creation.icosphere(subdivisions=2, radius=0.18), YELLOW), (1.09, 1.15, 0))
add('left_leg', paint(trimesh.creation.cylinder(radius=0.13, height=0.72, sections=16), INK), (-0.31, -0.83, 0))
add('right_leg', paint(trimesh.creation.cylinder(radius=0.13, height=0.72, sections=16), INK), (0.31, -0.83, 0))
add('left_foot', paint(trimesh.creation.box((0.38, 0.16, 0.52)), INK), (-0.34, -1.22, 0.12))
add('right_foot', paint(trimesh.creation.box((0.38, 0.16, 0.52)), INK), (0.34, -1.22, 0.12))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(scene.export(file_type='glb'))
print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')
