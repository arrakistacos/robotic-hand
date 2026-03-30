#!/usr/bin/env python3
"""
Export the robotic hand to GLTF format for Three.js.
"""

import bpy
import os

# Ensure we're in the right directory
output_dir = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(output_dir, "robotic_hand.gltf")

# Select all objects for export
bpy.ops.object.select_all(action='SELECT')

# Export to GLTF
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLTF_SEPARATE',
    export_cameras=False,
    export_lights=False,
    export_materials='EXPORT',
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False
)

print(f"Exported to: {output_path}")

# Also save the blend file
blend_path = os.path.join(output_dir, "robotic_hand.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"Saved blend file to: {blend_path}")