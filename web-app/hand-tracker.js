/**
 * Robotic Hand Tracker
 * Maps MediaPipe hand landmarks to the Three.js robotic hand model
 * 
 * MediaPipe Hand Landmarks (21 points):
 * 0: Wrist
 * 1-4: Thumb (CMC, MCP, IP, tip)
 * 5-8: Index (MCP, PIP, DIP, tip)
 * 9-12: Middle (MCP, PIP, DIP, tip)
 * 13-16: Ring (MCP, PIP, DIP, tip)
 * 17-20: Pinky (MCP, PIP, DIP, tip)
 * 
 * Bone Mapping:
 * - Wrist (0) -> Root bone
 * - Each finger chain: MCP -> PIP -> DIP -> tip
 * - Thumb: CMC -> MCP -> IP -> tip (special case)
 */

// Configuration
const CONFIG = {
    cameraWidth: 320,
    cameraHeight: 240,
    handConfidence: 0.5,
    trackingConfidence: 0.5,
    smoothFactor: 0.3,  // Lower = smoother but more lag
    scaleFactor: 5    // Scale hand model
};

// Global state
let scene, camera, renderer, controls;
let roboticHand = null;
let bones = {};
let targetRotations = {};
let isTracking = false;
let hands;
let webcamElement, canvasElement, canvasCtx;

// Landmark indices
const LANDMARKS = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Bone names mapping
const BONE_NAMES = {
    // Standard fingers: MCP -> PIP -> DIP
    INDEX: ['Index_MCP', 'Index_PIP', 'Index_DIP'],
    MIDDLE: ['Middle_MCP', 'Middle_PIP', 'Middle_DIP'],
    RING: ['Ring_MCP', 'Ring_PIP', 'Ring_DIP'],
    PINKY: ['Pinky_MCP', 'Pinky_PIP', 'Pinky_DIP'],
    // Thumb: CMC -> IP (our model uses Proximal instead of MCP)
    THUMB: ['Thumb_CMC', 'Thumb_IP']
};

/**
 * Initialize Three.js scene
 */
function initThreeJS() {
    const container = document.getElementById('scene-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 0.5);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('three-canvas'),
        antialias: true,
        alpha: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    
    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    const pointLight = new THREE.PointLight(0x00ff88, 0.5, 10);
    pointLight.position.set(-2, 3, 2);
    scene.add(pointLight);
    
    // Grid helper
    const gridHelper = new THREE.GridHelper(2, 20, 0x444444, 0x222222);
    scene.add(gridHelper);
    
    // Load robotic hand model
    loadRoboticHand();
    
    // Handle resize
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
}

/**
 * Load the GLTF robotic hand model
 */
function loadRoboticHand() {
    const loader = new THREE.GLTFLoader();
    
    loader.load('robotic_hand.gltf', (gltf) => {
        roboticHand = gltf.scene;
        
        // Scale and position
        roboticHand.scale.set(CONFIG.scaleFactor, CONFIG.scaleFactor, CONFIG.scaleFactor);
        
        // Find armature and bones
        roboticHand.traverse((child) => {
            if (child.isBone) {
                bones[child.name] = child;
                // Initialize target rotations
                targetRotations[child.name] = {
                    x: child.rotation.x,
                    y: child.rotation.y,
                    z: child.rotation.z
                };
            }
        });
        
        console.log('Loaded bones:', Object.keys(bones));
        
        // Add to scene
        scene.add(roboticHand);
        
        updateStatus('active', 'Hand loaded - Start camera to track');
        document.getElementById('start-btn').disabled = false;
        
    }, undefined, (error) => {
        console.error('Error loading model:', error);
        updateStatus('error', 'Failed to load hand model');
    });
}

/**
 * Calculate angle between three points (in 3D)
 */
function calculateJointAngle(p1, p2, p3) {
    const v1 = new THREE.Vector3(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
    const v2 = new THREE.Vector3(p3.x - p2.x, p3.y - p2.y, p3.z - p2.z);
    
    v1.normalize();
    v2.normalize();
    
    return Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
}

/**
 * Calculate the rotation needed to align a bone with two points
 */
function calculateBoneRotation(start, end) {
    const direction = new THREE.Vector3(
        end.x - start.x,
        end.y - start.y,
        end.z - start.z
    );
    
    // Default bone direction is Y+ in our rig
    const defaultDir = new THREE.Vector3(0, 1, 0);
    direction.normalize();
    
    // Calculate quaternion to rotate from default to target
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(defaultDir, direction);
    
    // Convert to Euler
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    
    return euler;
}

/**
 * Calculate finger curl angle
 * Returns angle in radians (0 = straight, positive = curled)
 */
function calculateFingerCurl(mcp, pip, dip, tip) {
    // Calculate two segments: MCP-PIP and PIP-DIP
    const segment1 = calculateJointAngle(mcp, pip, dip);
    const segment2 = calculateJointAngle(pip, dip, tip);
    
    // Average curl
    return (segment1 + segment2) / 2;
}

/**
 * Map MediaPipe landmarks to robotic hand bone rotations
 */
function mapLandmarksToBones(landmarks) {
    if (!roboticHand || Object.keys(bones).length === 0) return;
    
    // Wrist rotation (whole hand)
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    
    // Calculate hand orientation
    if (bones['Root']) {
        const wristRot = calculateBoneRotation(wrist, middleMCP);
        // Invert X because MediaPipe is mirrored
        targetRotations['Root'] = {
            x: -wristRot.x,
            y: wristRot.y + Math.PI, // Flip for mirror
            z: -wristRot.z
        };
    }
    
    // Map each finger
    const fingers = [
        { name: 'INDEX', mcp: LANDMARKS.INDEX_MCP, pip: LANDMARKS.INDEX_PIP, 
          dip: LANDMARKS.INDEX_DIP, tip: LANDMARKS.INDEX_TIP },
        { name: 'MIDDLE', mcp: LANDMARKS.MIDDLE_MCP, pip: LANDMARKS.MIDDLE_PIP,
          dip: LANDMARKS.MIDDLE_DIP, tip: LANDMARKS.MIDDLE_TIP },
        { name: 'RING', mcp: LANDMARKS.RING_MCP, pip: LANDMARKS.RING_PIP,
          dip: LANDMARKS.RING_DIP, tip: LANDMARKS.RING_TIP },
        { name: 'PINKY', mcp: LANDMARKS.PINKY_MCP, pip: LANDMARKS.PINKY_PIP,
          dip: LANDMARKS.PINKY_DIP, tip: LANDMARKS.PINKY_TIP },
        { name: 'THUMB', mcp: LANDMARKS.THUMB_MCP, pip: LANDMARKS.THUMB_IP,
          dip: LANDMARKS.THUMB_TIP, tip: LANDMARKS.THUMB_TIP, isThumb: true }
    ];
    
    fingers.forEach(finger => {
        const boneNames = BONE_NAMES[finger.name];
        if (!boneNames) return;
        
        const mcp = landmarks[finger.mcp];
        const pip = landmarks[finger.pip];
        const dip = landmarks[finger.dip];
        const tip = landmarks[finger.tip];
        
        if (finger.isThumb) {
            // Thumb uses different calculation
            const cmcAngle = calculateJointAngle(wrist, mcp, pip);
            const ipAngle = calculateJointAngle(mcp, pip, dip);
            
            if (bones['Thumb_CMC']) {
                targetRotations['Thumb_CMC'] = {
                    x: cmcAngle * 0.5,
                    y: finger.name === 'THUMB' ? 0.3 : 0, // Thumb spread
                    z: 0
                };
            }
            
            if (bones['Thumb_IP']) {
                targetRotations['Thumb_IP'] = {
                    x: ipAngle,
                    y: 0,
                    z: 0
                };
            }
        } else {
            // Standard finger with 3 joints
            const mcpToPip = calculateJointAngle(wrist, mcp, pip);
            const pipToDip = calculateJointAngle(mcp, pip, dip);
            const dipToTip = calculateJointAngle(pip, dip, tip);
            
            // MCP joint (knuckle) - flexion + slight spread
            if (bones[`${finger.name}_MCP`]) {
                targetRotations[`${finger.name}_MCP`] = {
                    x: mcpToPip * 0.8,  // Flexion
                    y: 0,  // Spread calculated separately
                    z: 0
                };
            }
            
            // PIP joint
            if (bones[`${finger.name}_PIP`]) {
                targetRotations[`${finger.name}_PIP`] = {
                    x: pipToDip,
                    y: 0,
                    z: 0
                };
            }
            
            // DIP joint
            if (bones[`${finger.name}_DIP`]) {
                targetRotations[`${finger.name}_DIP`] = {
                    x: dipToTip,
                    y: 0,
                    z: 0
                };
            }
        }
    });
}

/**
 * Apply smoothed rotations to bones
 */
function updateBoneRotations() {
    if (!roboticHand) return;
    
    Object.keys(targetRotations).forEach(boneName => {
        const bone = bones[boneName];
        const target = targetRotations[boneName];
        
        if (bone && target) {
            // Smooth interpolation
            bone.rotation.x += (target.x - bone.rotation.x) * CONFIG.smoothFactor;
            bone.rotation.y += (target.y - bone.rotation.y) * CONFIG.smoothFactor;
            bone.rotation.z += (target.z - bone.rotation.z) * CONFIG.smoothFactor;
        }
    });
}

/**
 * MediaPipe hands callback
 */
function onResults(results) {
    // Clear overlay canvas
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw landmarks
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS,
            {color: '#00FF88', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks,
            {color: '#FF4444', lineWidth: 1, radius: 3});
        
        // Map to robotic hand
        mapLandmarksToBones(landmarks);
        
        // Update debug info
        updateDebugInfo(landmarks);
        
        updateStatus('active', 'Tracking active');
        isTracking = true;
    } else {
        updateStatus('active', 'No hand detected');
        isTracking = false;
    }
    
    canvasCtx.restore();
}

/**
 * Update debug display
 */
function updateDebugInfo(landmarks) {
    const debugEl = document.getElementById('landmark-debug');
    const wrist = landmarks[0];
    const indexTip = landmarks[8];
    
    const info = `
Wrist: ${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)}, ${wrist.z.toFixed(2)}
Index Tip: ${indexTip.x.toFixed(2)}, ${indexTip.y.toFixed(2)}
Tracking: ${isTracking ? 'YES' : 'NO'}
Bones: ${Object.keys(bones).length}
    `.trim();
    
    debugEl.textContent = info;
}

/**
 * Update status display
 */
function updateStatus(className, message) {
    const statusEl = document.getElementById('status');
    statusEl.className = className;
    statusEl.textContent = message;
}

/**
 * Initialize MediaPipe Hands
 */
function initMediaPipe() {
    webcamElement = document.getElementById('webcam');
    canvasElement = document.getElementById('canvas-overlay');
    canvasCtx = canvasElement.getContext('2d');
    
    // Set canvas size
    canvasElement.width = CONFIG.cameraWidth;
    canvasElement.height = CONFIG.cameraHeight;
    
    // Initialize MediaPipe Hands
    hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: CONFIG.handConfidence,
        minTrackingConfidence: CONFIG.trackingConfidence
    });
    
    hands.onResults(onResults);
    
    updateStatus('active', 'Ready - Click Start Camera');
}

/**
 * Start camera
 */
async function startCamera() {
    const camera = new Camera(webcamElement, {
        onFrame: async () => {
            await hands.send({image: webcamElement});
        },
        width: CONFIG.cameraWidth,
        height: CONFIG.cameraHeight
    });
    
    try {
        await camera.start();
        document.getElementById('start-btn').textContent = 'Camera Active';
        document.getElementById('start-btn').disabled = true;
    } catch (error) {
        console.error('Camera error:', error);
        updateStatus('error', 'Camera access denied');
    }
}

/**
 * Animation loop
 */
function animate() {
    requestAnimationFrame(animate);
    
    // Update bone rotations
    updateBoneRotations();
    
    // Update controls
    controls.update();
    
    // Render
    renderer.render(scene, camera);
}

/**
 * Handle window resize
 */
function onWindowResize() {
    const container = document.getElementById('scene-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initThreeJS();
    initMediaPipe();
    
    document.getElementById('start-btn').addEventListener('click', startCamera);
});