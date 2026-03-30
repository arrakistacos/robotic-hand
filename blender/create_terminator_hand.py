#!/usr/bin/env python3
"""
Terminator T-800 Endoskeleton Hand
Exposed metal endoskeleton with hydraulic pistons and visible joints
"""

import bpy
import bmesh
import math
from mathutils import Vector, Matrix

def clear_scene():
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.select_by_type(type='MESH')
    bpy.ops.object.select_by_type(type='ARMATURE')
    bpy.ops.object.delete()
    
    for material in bpy.data.materials:
        bpy.data.materials.remove(material)

def create_endo_material(name):
    """Create brushed metal endoskeleton material"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    
    # Dark brushed metal
    bsdf.inputs['Base Color'].default_value = (0.15, 0.15, 0.18, 1.0)
    bsdf.inputs['Metallic'].default_value = 0.95
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Specular IOR Level'].default_value = 0.6
    
    # Subtle scratches/variation
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 50.0
    noise.inputs['Detail'].default_value = 2.0
    
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.color_ramp.elements[0].color = (0.12, 0.12, 0.14, 1.0)
    color_ramp.color_ramp.elements[1].color = (0.18, 0.18, 0.22, 1.0)
    
    mapping = nodes.new('ShaderNodeMapping')
    tex_coord = nodes.new('ShaderNodeTexCoord')
    
    mat.node_tree.links.new(tex_coord.outputs['UV'], mapping.inputs['Vector'])
    mat.node_tree.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    mat.node_tree.links.new(noise.outputs['Fac'], color_ramp.inputs['Fac'])
    mat.node_tree.links.new(color_ramp.outputs['Color'], bsdf.inputs['Base Color'])
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    
    return mat

def create_piston_material():
    """Create shiny piston hydraulic material"""
    mat = bpy.data.materials.new(name="Piston_Metal")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    
    bsdf.inputs['Base Color'].default_value = (0.25, 0.25, 0.28, 1.0)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.15
    
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    return mat

def create_joint_material():
    """Create copper/brass joint material"""
    mat = bpy.data.materials.new(name="Joint_Metal")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    
    bsdf.inputs['Base Color'].default_value = (0.45, 0.3, 0.15, 1.0)
    bsdf.inputs['Metallic'].default_value = 0.9
    bsdf.inputs['Roughness'].default_value = 0.25
    
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    return mat

def create_endo_phalanx(name, length, radius, location, rotation, material, has_piston=False):
    """Create a terminator-style finger segment with visible pistons"""
    
    # Main segment - cylindrical with chamfered edges
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius,
        depth=length * 0.8,
        location=location,
        rotation=rotation,
        vertices=12
    )
    obj = bpy.context.active_object
    obj.name = f"{name}_Segment"
    
    # Add bevel for chamfered edges
    bevel = obj.modifiers.new(name="Bevel", type='BEVEL')
    bevel.width = radius * 0.1
    bevel.segments = 2
    
    if material:
        obj.data.materials.append(material)
    
    # Add piston on one side if requested
    if has_piston:
        piston_loc = Vector(location) + Vector((radius * 1.3, 0, 0))
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius * 0.25,
            depth=length * 0.6,
            location=piston_loc,
            rotation=rotation,
            vertices=8
        )
        piston = bpy.context.active_object
        piston.name = f"{name}_Piston"
        piston_mat = create_piston_material()
        piston.data.materials.append(piston_mat)
        
        # Parent piston to segment
        piston.parent = obj
    
    return obj

def create_hinged_joint(name, radius, location, material):
    """Create a visible hinged joint with pin"""
    # Joint housing
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius,
        location=location,
        segments=12,
        ring_count=8
    )
    obj = bpy.context.active_object
    obj.name = f"{name}_Joint"
    
    if material:
        obj.data.materials.append(material)
    
    # Visible hinge pin
    pin_loc = list(location)
    pin_loc[0] += radius * 1.1  # Offset to side
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius * 0.3,
        depth=radius * 2.5,
        location=pin_loc,
        rotation=(0, math.radians(90), 0),
        vertices=8
    )
    pin = bpy.context.active_object
    pin.name = f"{name}_Pin"
    pin.parent = obj
    
    joint_mat = create_joint_material()
    pin.data.materials.append(joint_mat)
    
    return obj

def create_endo_finger(name, base_pos, lengths, radii, is_thumb=False):
    """Create a terminator-style finger with pistons and visible joints"""
    segments = []
    joints = []
    
    endo_mat = create_endo_material(f"{name}_Metal")
    joint_mat = create_joint_material()
    
    current_pos = Vector(base_pos)
    
    if not is_thumb:
        # Standard finger: MCP -> Proximal -> PIP -> Middle -> DIP -> Distal
        
        # MCP Joint (knuckle)
        joint = create_hinged_joint(f"{name}_MCP", radii[0] * 1.2, current_pos, joint_mat)
        joints.append(joint)
        
        # Proximal segment
        seg_length = lengths[0]
        seg_pos = current_pos + Vector((0, seg_length * 0.4, 0))
        proximal = create_endo_phalanx(f"{name}_Proximal", seg_length, radii[0], seg_pos, 
                                       (math.radians(90), 0, 0), endo_mat, has_piston=True)
        proximal.parent = joint
        segments.append(proximal)
        
        current_pos = current_pos + Vector((0, seg_length * 0.8, 0))
        
        # PIP Joint
        joint = create_hinged_joint(f"{name}_PIP", radii[1] * 1.1, current_pos, joint_mat)
        joints.append(joint)
        
        # Middle segment
        seg_length = lengths[1]
        seg_pos = current_pos + Vector((0, seg_length * 0.4, 0))
        middle = create_endo_phalanx(f"{name}_Middle", seg_length, radii[1], seg_pos,
                                     (math.radians(90), 0, 0), endo_mat, has_piston=True)
        middle.parent = joint
        segments.append(middle)
        
        current_pos = current_pos + Vector((0, seg_length * 0.8, 0))
        
        # DIP Joint
        joint = create_hinged_joint(f"{name}_DIP", radii[2] * 1.0, current_pos, joint_mat)
        joints.append(joint)
        
        # Distal segment
        seg_length = lengths[2]
        seg_pos = current_pos + Vector((0, seg_length * 0.4, 0))
        distal = create_endo_phalanx(f"{name}_Distal", seg_length, radii[2], seg_pos,
                                   (math.radians(90), 0, 0), endo_mat)
        distal.parent = joint
        segments.append(distal)
        
    else:
        # Thumb: CMC -> Proximal -> IP -> Distal
        
        # CMC Joint
        joint = create_hinged_joint(f"Thumb_CMC", radii[0] * 1.3, current_pos, joint_mat)
        joints.append(joint)
        
        seg_length = lengths[0]
        seg_pos = current_pos + Vector((0, seg_length * 0.4, 0))
        proximal = create_endo_phalanx("Thumb_Proximal", seg_length, radii[0], seg_pos,
                                     (math.radians(90), 0, 0), endo_mat, has_piston=True)
        proximal.parent = joint
        segments.append(proximal)
        
        current_pos = current_pos + Vector((0, seg_length * 0.8, 0))
        
        # IP Joint
        joint = create_hinged_joint("Thumb_IP", radii[1] * 1.1, current_pos, joint_mat)
        joints.append(joint)
        
        seg_length = lengths[1]
        seg_pos = current_pos + Vector((0, seg_length * 0.4, 0))
        distal = create_endo_phalanx("Thumb_Distal", seg_length, radii[1], seg_pos,
                                   (math.radians(90), 0, 0), endo_mat)
        distal.parent = joint
        segments.append(distal)
    
    return segments, joints

def create_armature_and_rig(wrist_pos, finger_configs):
    """Create armature with proper bone hierarchy"""
    
    bpy.ops.object.armature_add(location=wrist_pos)
    armature = bpy.context.active_object
    armature.name = "TerminatorHand_Armature"
    armature.data.name = "TerminatorHand_Skeleton"
    armature.data.display_type = 'STICK'
    
    bpy.ops.object.mode_set(mode='EDIT')
    edit_bones = armature.data.edit_bones
    
    for bone in list(edit_bones):
        edit_bones.remove(bone)
    
    # Create bone hierarchy
    root = edit_bones.new("Root")
    root.head = wrist_pos
    root.tail = (wrist_pos[0], wrist_pos[1] + 0.05, wrist_pos[2])
    
    palm = edit_bones.new("Palm")
    palm.head = (wrist_pos[0], wrist_pos[1] + 0.02, wrist_pos[2])
    palm.tail = (wrist_pos[0], wrist_pos[1] + 0.08, wrist_pos[2])
    palm.parent = root
    
    for config in finger_configs:
        name = config['name']
        base_pos = config['base_pos']
        lengths = config['lengths']
        is_thumb = config.get('is_thumb', False)
        
        if is_thumb:
            cmc = edit_bones.new("Thumb_CMC")
            cmc.head = base_pos
            cmc.tail = (base_pos[0], base_pos[1] + 0.02, base_pos[2])
            cmc.parent = palm
            
            proximal = edit_bones.new("Thumb_Proximal")
            proximal.head = cmc.tail
            proximal.tail = (cmc.tail[0], cmc.tail[1] + lengths[0] * 0.7, cmc.tail[2] + lengths[0] * 0.3)
            proximal.parent = cmc
            
            ip = edit_bones.new("Thumb_IP")
            ip.head = proximal.tail
            ip.tail = (ip.head[0], ip.head[1] + 0.015, ip.head[2] + 0.015)
            ip.parent = proximal
            
            distal = edit_bones.new("Thumb_Distal")
            distal.head = ip.tail
            distal.tail = (ip.tail[0], ip.tail[1] + lengths[1] * 0.7, ip.tail[2] + lengths[1] * 0.3)
            distal.parent = ip
        else:
            mcp = edit_bones.new(f"{name}_MCP")
            mcp.head = base_pos
            mcp.tail = (base_pos[0], base_pos[1] + 0.02, base_pos[2])
            mcp.parent = palm
            
            proximal = edit_bones.new(f"{name}_Proximal")
            proximal.head = mcp.tail
            proximal.tail = (mcp.tail[0], mcp.tail[1] + lengths[0], mcp.tail[2])
            proximal.parent = mcp
            
            pip = edit_bones.new(f"{name}_PIP")
            pip.head = proximal.tail
            pip.tail = (pip.head[0], pip.head[1] + 0.015, pip.head[2])
            pip.parent = proximal
            
            middle = edit_bones.new(f"{name}_Middle")
            middle.head = pip.tail
            middle.tail = (middle.head[0], middle.head[1] + lengths[1], middle.head[2])
            middle.parent = pip
            
            dip = edit_bones.new(f"{name}_DIP")
            dip.head = middle.tail
            dip.tail = (dip.head[0], dip.head[1] + 0.012, dip.head[2])
            dip.parent = middle
            
            distal = edit_bones.new(f"{name}_Distal")
            distal.head = dip.tail
            distal.tail = (distal.head[0], distal.head[1] + lengths[2], distal.head[2])
            distal.parent = dip
    
    bpy.ops.object.mode_set(mode='OBJECT')
    
    return armature

def create_terminator_hand():
    clear_scene()
    
    wrist_pos = (0, 0, 0)
    
    # Palm - mechanical plate
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(wrist_pos[0], wrist_pos[1] + 0.06, wrist_pos[2])
    )
    palm = bpy.context.active_object
    palm.name = "Palm_Base"
    palm.scale = (0.14, 0.08, 0.02)
    palm.rotation_euler = (0, 0, math.radians(-5))
    
    bevel = palm.modifiers.new(name="Bevel", type='BEVEL')
    bevel.width = 0.003
    bevel.segments = 2
    
    endo_mat = create_endo_material("Palm_Metal")
    palm.data.materials.append(endo_mat)
    
    # Finger configs
    finger_configs = [
        {'name': 'Index', 'base_pos': (-0.05, 0.08, 0), 'lengths': [0.075, 0.055, 0.035], 'radii': [0.011, 0.010, 0.009]},
        {'name': 'Middle', 'base_pos': (-0.017, 0.085, 0), 'lengths': [0.085, 0.06, 0.04], 'radii': [0.012, 0.011, 0.010]},
        {'name': 'Ring', 'base_pos': (0.017, 0.082, 0), 'lengths': [0.08, 0.055, 0.035], 'radii': [0.0115, 0.0105, 0.0095]},
        {'name': 'Pinky', 'base_pos': (0.05, 0.075, 0), 'lengths': [0.055, 0.04, 0.03], 'radii': [0.009, 0.008, 0.007]},
        {'name': 'Thumb', 'base_pos': (-0.08, 0.03, 0), 'lengths': [0.065, 0.045], 'radii': [0.013, 0.011], 'is_thumb': True}
    ]
    
    # Create fingers
    for config in finger_configs:
        segments, joints = create_endo_finger(
            config['name'],
            config['base_pos'],
            config['lengths'],
            config['radii'],
            config.get('is_thumb', False)
        )
        for obj in segments + joints:
            obj.parent = palm
    
    # Create armature
    armature = create_armature_and_rig(wrist_pos, finger_configs)
    palm.parent = armature
    
    # Setup camera for full view
    bpy.ops.object.camera_add(location=(0.3, -0.3, 0.4))
    camera = bpy.context.active_object
    camera.rotation_euler = (math.radians(65), 0, math.radians(45))
    bpy.context.scene.camera = camera
    
    # Lighting
    bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
    sun = bpy.context.active_object
    sun.data.energy = 5
    
    # Save
    bpy.ops.wm.save_as_mainfile(filepath="/home/freeman/.openclaw/workspace/robotic-hand/blender/terminator_hand.blend")
    
    # Export
    bpy.ops.export_scene.gltf(
        filepath="/home/freeman/.openclaw/workspace/robotic-hand/blender/terminator_hand.gltf",
        export_format='GLTF_SEPARATE',
        export_materials='EXPORT',
        export_yup=True
    )
    
    print("Terminator hand created!")

if __name__ == "__main__":
    create_terminator_hand()
