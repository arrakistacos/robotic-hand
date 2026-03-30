#!/usr/bin/env python3
"""
Robotic Hand Generator for Blender
Phase 1: Foundation - Mechanical hand with proper joint hierarchy

Joint Structure:
- Wrist (carpals) - Root of the hand
- Metacarpals (5 bones) - Palm section
- Proximal Phalanges (4 fingers + thumb) - First finger segments
- Middle Phalanges (4 fingers) - Second segments
- Distal Phalanges (5 digits) - Fingertips

Constraints:
- MCP joints (knuckles): Rotation limited to flexion/extension, slight abduction
- PIP joints: Hinge only (flexion/extension)
- DIP joints: Hinge only (flexion/extension)
- Thumb CMC: Ball joint - more freedom
"""

import bpy
import bmesh
import math
from mathutils import Vector, Euler

def clear_scene():
    """Remove all mesh objects and armatures."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.select_by_type(type='MESH')
    bpy.ops.object.select_by_type(type='ARMATURE')
    bpy.ops.object.delete()
    
    # Remove materials
    for material in bpy.data.materials:
        bpy.data.materials.remove(material)

def create_material(name, color, metallic=0.8, roughness=0.3):
    """Create a metallic robotic material."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    # Output
    output = nodes.new('ShaderNodeOutputMaterial')
    
    # Principled BSDF
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = 0.5
    
    # Link
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    
    return mat

def create_cylinder_segment(name, radius, length, location, rotation, material):
    """Create a finger/phalanx segment."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius,
        depth=length,
        location=location,
        rotation=rotation,
        vertices=16
    )
    obj = bpy.context.active_object
    obj.name = name
    
    # Add bevel for robotic look
    modifier = obj.modifiers.new(name="Bevel", type='BEVEL')
    modifier.width = 0.005
    modifier.segments = 2
    
    # Assign material
    if material:
        obj.data.materials.append(material)
    
    return obj

def create_joint_sphere(name, radius, location, material):
    """Create a joint visualization."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius,
        location=location,
        segments=12,
        ring_count=8
    )
    obj = bpy.context.active_object
    obj.name = name
    
    if material:
        obj.data.materials.append(material)
    
    return obj

def create_palm_base(wrist_pos, palm_material, joint_material):
    """Create the palm/metacarpal base structure."""
    # Main palm block - slightly curved
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(wrist_pos[0], wrist_pos[1] + 0.06, wrist_pos[2])
    )
    palm = bpy.context.active_object
    palm.name = "Palm_Base"
    palm.scale = (0.14, 0.08, 0.025)
    
    # Rotate slightly for natural hand curve
    palm.rotation_euler = (0, 0, math.radians(-5))
    
    if palm_material:
        palm.data.materials.append(palm_material)
    
    # Add bevel
    modifier = palm.modifiers.new(name="Bevel", type='BEVEL')
    modifier.width = 0.003
    modifier.segments = 2
    
    return palm

def create_finger(name, base_pos, lengths, radii, is_thumb=False, palm_material=None, joint_material=None):
    """
    Create a finger with proper segments and joint spheres.
    
    Args:
        name: Finger name prefix
        base_pos: Starting position (MCP joint)
        lengths: List of segment lengths [proximal, middle, distal]
        radii: List of segment radii
        is_thumb: If True, only 2 segments
    """
    segments = []
    joints = []
    
    # Finger extends along Y axis (pointing forward from palm)
    # Z is up
    
    current_pos = Vector(base_pos)
    direction = Vector((0, 1, 0))  # Pointing forward
    
    # MCP Joint (knuckle)
    joint = create_joint_sphere(f"{name}_MCP_Joint", radii[0] * 1.2, current_pos, joint_material)
    joints.append(joint)
    
    if not is_thumb:
        # Standard finger: MCP -> Proximal -> PIP -> Middle -> DIP -> Distal
        
        # Proximal phalanx
        seg_length = lengths[0]
        seg_pos = current_pos + direction * (seg_length / 2)
        proximal = create_cylinder_segment(
            f"{name}_Proximal",
            radii[0],
            seg_length,
            seg_pos,
            (math.radians(90), 0, 0),
            palm_material
        )
        segments.append(proximal)
        
        current_pos = current_pos + direction * seg_length
        
        # PIP Joint
        joint = create_joint_sphere(f"{name}_PIP_Joint", radii[1] * 1.1, current_pos, joint_material)
        joints.append(joint)
        
        # Middle phalanx
        seg_length = lengths[1]
        seg_pos = current_pos + direction * (seg_length / 2)
        middle = create_cylinder_segment(
            f"{name}_Middle",
            radii[1],
            seg_length,
            seg_pos,
            (math.radians(90), 0, 0),
            palm_material
        )
        segments.append(middle)
        
        current_pos = current_pos + direction * seg_length
        
        # DIP Joint
        joint = create_joint_sphere(f"{name}_DIP_Joint", radii[2] * 1.0, current_pos, joint_material)
        joints.append(joint)
        
        # Distal phalanx
        seg_length = lengths[2]
        seg_pos = current_pos + direction * (seg_length / 2)
        distal = create_cylinder_segment(
            f"{name}_Distal",
            radii[2],
            seg_length,
            seg_pos,
            (math.radians(90), 0, 0),
            palm_material
        )
        segments.append(distal)
        
    else:
        # Thumb: CMC -> Proximal -> IP -> Distal
        # Thumb is offset and angled differently
        
        # Proximal phalanx (thumb has 2 segments)
        seg_length = lengths[0]
        seg_pos = current_pos + direction * (seg_length / 2)
        proximal = create_cylinder_segment(
            f"{name}_Proximal",
            radii[0],
            seg_length,
            seg_pos,
            (math.radians(90), 0, 0),
            palm_material
        )
        segments.append(proximal)
        
        current_pos = current_pos + direction * seg_length
        
        # IP Joint
        joint = create_joint_sphere(f"{name}_IP_Joint", radii[1] * 1.1, current_pos, joint_material)
        joints.append(joint)
        
        # Distal phalanx
        seg_length = lengths[1]
        seg_pos = current_pos + direction * (seg_length / 2)
        distal = create_cylinder_segment(
            f"{name}_Distal",
            radii[1],
            seg_length,
            seg_pos,
            (math.radians(90), 0, 0),
            palm_material
        )
        segments.append(distal)
    
    return segments, joints

def create_armature_and_rig(wrist_pos, finger_configs):
    """
    Create the armature with proper bone hierarchy for animation.
    
    Bone hierarchy:
    Root (Wrist)
    ├── Palm
    │   ├── Index_MCP -> Index_PIP -> Index_DIP
    │   ├── Middle_MCP -> Middle_PIP -> Middle_DIP
    │   ├── Ring_MCP -> Ring_PIP -> Ring_DIP
    │   ├── Pinky_MCP -> Pinky_PIP -> Pinky_DIP
    │   └── Thumb_CMC -> Thumb_IP
    """
    
    # Create armature
    bpy.ops.object.armature_add(location=wrist_pos)
    armature = bpy.context.active_object
    armature.name = "RoboticHand_Armature"
    armature.data.name = "RoboticHand_Skeleton"
    
    # Enter edit mode
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    
    edit_bones = armature.data.edit_bones
    
    # Clear default bone
    for bone in edit_bones:
        edit_bones.remove(bone)
    
    # Create Root/Wrist bone
    root = edit_bones.new("Root")
    root.head = wrist_pos
    root.tail = (wrist_pos[0], wrist_pos[1], wrist_pos[2] + 0.05)
    root.use_deform = False
    
    # Create Palm bone
    palm = edit_bones.new("Palm")
    palm.head = (wrist_pos[0], wrist_pos[1] + 0.02, wrist_pos[2])
    palm.tail = (wrist_pos[0], wrist_pos[1] + 0.08, wrist_pos[2])
    palm.parent = root
    
    bones_created = {"Root": root, "Palm": palm}
    
    # Create finger bones
    for config in finger_configs:
        name = config['name']
        base_pos = config['base_pos']
        lengths = config['lengths']
        is_thumb = config.get('is_thumb', False)
        
        if is_thumb:
            # Thumb: CMC -> Proximal -> IP -> Distal
            # Note: Thumb CMC is at palm, proximal extends from there
            
            # CMC joint at palm connection
            cmc = edit_bones.new(f"{name}_CMC")
            cmc.head = base_pos
            cmc.tail = (base_pos[0], base_pos[1] + 0.02, base_pos[2])
            cmc.parent = palm
            bones_created[f"{name}_CMC"] = cmc
            
            # Proximal segment
            proximal = edit_bones.new(f"{name}_Proximal")
            proximal.head = cmc.tail
            proximal.tail = (
                cmc.tail[0],
                cmc.tail[1] + lengths[0] * 0.7,  # Thumb angles outward
                cmc.tail[2] + lengths[0] * 0.3
            )
            proximal.parent = cmc
            bones_created[f"{name}_Proximal"] = proximal
            
            # IP joint
            ip = edit_bones.new(f"{name}_IP")
            ip.head = proximal.tail
            ip.tail = (
                proximal.tail[0],
                proximal.tail[1] + 0.015,
                proximal.tail[2] + 0.015
            )
            ip.parent = proximal
            bones_created[f"{name}_IP"] = ip
            
            # Distal segment
            distal = edit_bones.new(f"{name}_Distal")
            distal.head = ip.tail
            distal.tail = (
                ip.tail[0],
                ip.tail[1] + lengths[1] * 0.7,
                ip.tail[2] + lengths[1] * 0.3
            )
            distal.parent = ip
            bones_created[f"{name}_Distal"] = distal
            
        else:
            # Standard finger: MCP -> Proximal -> PIP -> Middle -> DIP -> Distal
            
            # MCP joint (knuckle)
            mcp = edit_bones.new(f"{name}_MCP")
            mcp.head = base_pos
            mcp.tail = (base_pos[0], base_pos[1] + 0.02, base_pos[2])
            mcp.parent = palm
            bones_created[f"{name}_MCP"] = mcp
            
            # Proximal segment
            proximal = edit_bones.new(f"{name}_Proximal")
            proximal.head = mcp.tail
            proximal.tail = (mcp.tail[0], mcp.tail[1] + lengths[0], mcp.tail[2])
            proximal.parent = mcp
            bones_created[f"{name}_Proximal"] = proximal
            
            # PIP joint
            pip = edit_bones.new(f"{name}_PIP")
            pip.head = proximal.tail
            pip.tail = (pip.head[0], pip.head[1] + 0.015, pip.head[2])
            pip.parent = proximal
            bones_created[f"{name}_PIP"] = pip
            
            # Middle segment
            middle = edit_bones.new(f"{name}_Middle")
            middle.head = pip.tail
            middle.tail = (middle.head[0], middle.head[1] + lengths[1], middle.head[2])
            middle.parent = pip
            bones_created[f"{name}_Middle"] = middle
            
            # DIP joint
            dip = edit_bones.new(f"{name}_DIP")
            dip.head = middle.tail
            dip.tail = (dip.head[0], dip.head[1] + 0.012, dip.head[2])
            dip.parent = middle
            bones_created[f"{name}_DIP"] = dip
            
            # Distal segment
            distal = edit_bones.new(f"{name}_Distal")
            distal.head = dip.tail
            distal.tail = (distal.head[0], distal.head[1] + lengths[2], distal.head[2])
            distal.parent = dip
            bones_created[f"{name}_Distal"] = distal
    
    # Exit edit mode
    bpy.ops.object.mode_set(mode='OBJECT')
    
    return armature, bones_created

def add_constraints(armature, finger_configs):
    """
    Add rotation constraints to joints to simulate realistic joint limits.
    """
    bpy.context.view_layer.objects.active = armature
    
    # Switch to pose mode
    bpy.ops.object.mode_set(mode='POSE')
    
    for config in finger_configs:
        name = config['name']
        is_thumb = config.get('is_thumb', False)
        
        if is_thumb:
            # Thumb constraints
            # CMC: Ball joint - limited rotation
            cmc = armature.pose.bones.get(f"{name}_CMC")
            if cmc:
                limit_rot = cmc.constraints.new(type='LIMIT_ROTATION')
                limit_rot.use_limit_x = True
                limit_rot.min_x = math.radians(-30)
                limit_rot.max_x = math.radians(60)
                limit_rot.use_limit_y = True
                limit_rot.min_y = math.radians(-45)
                limit_rot.max_y = math.radians(45)
                limit_rot.use_limit_z = True
                limit_rot.min_z = math.radians(-20)
                limit_rot.max_z = math.radians(20)
                limit_rot.owner_space = 'LOCAL'
            
            # IP: Hinge joint
            ip = armature.pose.bones.get(f"{name}_IP")
            if ip:
                limit_rot = ip.constraints.new(type='LIMIT_ROTATION')
                limit_rot.use_limit_x = True
                limit_rot.min_x = math.radians(-80)
                limit_rot.max_x = math.radians(10)
                limit_rot.use_limit_y = True
                limit_rot.min_y = 0
                limit_rot.max_y = 0
                limit_rot.use_limit_z = True
                limit_rot.min_z = 0
                limit_rot.max_z = 0
                limit_rot.owner_space = 'LOCAL'
        else:
            # Standard finger constraints
            # MCP: Condyloid joint - flexion/extension, limited abduction
            mcp = armature.pose.bones.get(f"{name}_MCP")
            if mcp:
                limit_rot = mcp.constraints.new(type='LIMIT_ROTATION')
                limit_rot.use_limit_x = True  # Flexion/extension
                limit_rot.min_x = math.radians(-90)
                limit_rot.max_x = math.radians(30)
                limit_rot.use_limit_y = True  # Abduction/adduction
                limit_rot.min_y = math.radians(-15)
                limit_rot.max_y = math.radians(15)
                limit_rot.use_limit_z = True
                limit_rot.min_z = 0
                limit_rot.max_z = 0
                limit_rot.owner_space = 'LOCAL'
            
            # PIP: Hinge joint
            pip = armature.pose.bones.get(f"{name}_PIP")
            if pip:
                limit_rot = pip.constraints.new(type='LIMIT_ROTATION')
                limit_rot.use_limit_x = True
                limit_rot.min_x = math.radians(-100)
                limit_rot.max_x = math.radians(5)
                limit_rot.use_limit_y = True
                limit_rot.min_y = 0
                limit_rot.max_y = 0
                limit_rot.use_limit_z = True
                limit_rot.min_z = 0
                limit_rot.max_z = 0
                limit_rot.owner_space = 'LOCAL'
            
            # DIP: Hinge joint
            dip = armature.pose.bones.get(f"{name}_DIP")
            if dip:
                limit_rot = dip.constraints.new(type='LIMIT_ROTATION')
                limit_rot.use_limit_x = True
                limit_rot.min_x = math.radians(-80)
                limit_rot.max_x = math.radians(5)
                limit_rot.use_limit_y = True
                limit_rot.min_y = 0
                limit_rot.max_y = 0
                limit_rot.use_limit_z = True
                limit_rot.min_z = 0
                limit_rot.max_z = 0
                limit_rot.owner_space = 'LOCAL'
    
    bpy.ops.object.mode_set(mode='OBJECT')

def create_robotic_hand():
    """Main function to create the complete robotic hand."""
    
    clear_scene()
    
    # Materials
    primary_metal = create_material("Primary_Metal", (0.7, 0.75, 0.8), metallic=0.9, roughness=0.2)
    joint_metal = create_material("Joint_Metal", (0.3, 0.3, 0.35), metallic=0.7, roughness=0.4)
    accent_metal = create_material("Accent_Metal", (0.85, 0.6, 0.2), metallic=0.8, roughness=0.3)
    
    # Wrist position
    wrist_pos = (0, 0, 0)
    
    # Create palm base
    palm = create_palm_base(wrist_pos, primary_metal, joint_metal)
    
    # Finger configurations
    # Positions relative to palm (spaced across the top)
    finger_configs = [
        {
            'name': 'Index',
            'base_pos': (-0.05, 0.08, 0.02),
            'lengths': [0.08, 0.06, 0.04],
            'radii': [0.012, 0.011, 0.010],
            'is_thumb': False
        },
        {
            'name': 'Middle',
            'base_pos': (-0.017, 0.085, 0.02),
            'lengths': [0.09, 0.065, 0.045],
            'radii': [0.013, 0.012, 0.011],
            'is_thumb': False
        },
        {
            'name': 'Ring',
            'base_pos': (0.017, 0.082, 0.02),
            'lengths': [0.085, 0.06, 0.04],
            'radii': [0.0125, 0.0115, 0.0105],
            'is_thumb': False
        },
        {
            'name': 'Pinky',
            'base_pos': (0.05, 0.075, 0.02),
            'lengths': [0.06, 0.045, 0.035],
            'radii': [0.010, 0.009, 0.008],
            'is_thumb': False
        },
        {
            'name': 'Thumb',
            'base_pos': (-0.08, 0.03, 0.01),
            'lengths': [0.07, 0.05],
            'radii': [0.014, 0.012],
            'is_thumb': True
        }
    ]
    
    # Create finger geometry
    all_segments = []
    all_joints = []
    
    for config in finger_configs:
        segments, joints = create_finger(
            config['name'],
            config['base_pos'],
            config['lengths'],
            config['radii'],
            config.get('is_thumb', False),
            primary_metal,
            joint_metal
        )
        all_segments.extend(segments)
        all_joints.extend(joints)
    
    # Create armature and rig
    armature, bones = create_armature_and_rig(wrist_pos, finger_configs)
    
    # Add joint constraints
    add_constraints(armature, finger_configs)
    
    # Parent mesh objects to armature (for organization)
    for obj in all_segments + all_joints + [palm]:
        obj.parent = armature
    
    # Set up viewport
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    
    print("Robotic hand created successfully!")
    print(f"Armature: {armature.name}")
    print(f"Bones: {len(bones)}")
    print(f"Mesh segments: {len(all_segments)}")
    print(f"Joints: {len(all_joints)}")
    
    return armature, all_segments, all_joints

if __name__ == "__main__":
    create_robotic_hand()
