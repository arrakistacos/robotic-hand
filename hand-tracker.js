/**
 * Robotic Hand Tracker - Performance Optimized
 * Maps MediaPipe hand landmarks to the Three.js robotic hand model
 */

// Configuration
const CONFIG = {
    cameraWidth: 320,
    cameraHeight: 240,
    handConfidence: 0.5,
    trackingConfidence: 0.5,
    smoothFactor: 0.2,
    scaleFactor: 5
};

// MediaPipe hand connections (skeleton lines)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],           // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],           // Index
    [0, 9], [9, 10], [10, 11], [11, 12],      // Middle
    [0, 13], [13, 14], [14, 15], [15, 16],    // Ring
    [0, 17], [17, 18], [18, 19], [19, 20]     // Pinky
];

// Landmark indices
const LANDMARKS = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Global state
let scene, camera, renderer, controls;
let roboticHand = null;
let bones = {};
let targetRotations = {};
let currentLandmarks = null;
let isTracking = false;
let hands;
let webcamElement, canvasElement, canvasCtx;

// Pre-allocate vectors
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();

/**
 * Initialize Three.js scene
 */
function initThreeJS() {
    const container = document.getElementById('scene-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 0.5);
    
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('three-canvas'),
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);
    
    const gridHelper = new THREE.GridHelper(2, 20, 0x444444, 0x222222);
    scene.add(gridHelper);
    
    loadRoboticHand();
    
    window.addEventListener('resize', onWindowResize, { passive: true });
    animate();
}

/**
 * Load the GLTF robotic hand model
 */
function loadRoboticHand() {
    const loader = new THREE.GLTFLoader();
    
    loader.load('robotic_hand.gltf', (gltf) => {
        roboticHand = gltf.scene;
        roboticHand.scale.set(CONFIG.scaleFactor, CONFIG.scaleFactor, CONFIG.scaleFactor);
        
        // Find all bones and log their names
        const boneNames = [];
        roboticHand.traverse((child) => {
            if (child.isBone) {
                boneNames.push(child.name);
                bones[child.name] = child;
                targetRotations[child.name] = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z };
            }
        });
        
        console.log('Available bones:', boneNames);
        
        scene.add(roboticHand);
        
        updateStatus('active', 'Hand loaded - Start camera to track');
        document.getElementById('start-btn').disabled = false;
        
    }, undefined, (error) => {
        console.error('Error loading model:', error);
        updateStatus('error', 'Failed to load hand model');
    });
}

/**
 * Calculate angle between three points
 */
function calculateJointAngle(p1, p2, p3) {
    _vec1.set(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z).normalize();
    _vec2.set(p3.x - p2.x, p3.y - p2.y, p3.z - p2.z).normalize();
    
    const dot = Math.max(-1, Math.min(1, _vec1.dot(_vec2)));
    return Math.acos(dot);
}

/**
 * Get bone by name with fallback
 */
function getBone(name) {
    // Try exact match first
    if (bones[name]) return bones[name];
    
    // Try common variations
    const variations = [
        name,
        name.replace('_', '.'),
        name.toLowerCase(),
        name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    ];
    
    for (const variant of variations) {
        if (bones[variant]) return bones[variant];
    }
    
    return null;
}

/**
 * Map MediaPipe landmarks to robotic hand bone rotations
 */
function mapLandmarksToBones(landmarks) {
    if (!roboticHand || Object.keys(bones).length === 0) return;
    
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    
    // Wrist rotation
    const rootBone = getBone('Root');
    if (rootBone) {
        const angleY = Math.atan2(middleMCP.x - wrist.x, middleMCP.y - wrist.y);
        targetRotations['Root'] = {
            x: rootBone.rotation.x * 0.5,
            y: angleY + Math.PI,
            z: rootBone.rotation.z * 0.5
        };
    }
    
    // Map fingers
    const fingers = [
        { name: 'Index', mcp: LANDMARKS.INDEX_MCP, pip: LANDMARKS.INDEX_PIP, dip: LANDMARKS.INDEX_DIP },
        { name: 'Middle', mcp: LANDMARKS.MIDDLE_MCP, pip: LANDMARKS.MIDDLE_PIP, dip: LANDMARKS.MIDDLE_DIP },
        { name: 'Ring', mcp: LANDMARKS.RING_MCP, pip: LANDMARKS.RING_PIP, dip: LANDMARKS.RING_DIP },
        { name: 'Pinky', mcp: LANDMARKS.PINKY_MCP, pip: LANDMARKS.PINKY_PIP, dip: LANDMARKS.PINKY_DIP },
        { name: 'Thumb', mcp: LANDMARKS.THUMB_MCP, pip: LANDMARKS.THUMB_IP, dip: LANDMARKS.THUMB_TIP, isThumb: true }
    ];
    
    for (let i = 0; i < fingers.length; i++) {
        const f = fingers[i];
        const mcp = landmarks[f.mcp];
        const pip = landmarks[f.pip];
        const dip = landmarks[f.dip];
        
        if (f.isThumb) {
            const cmcAngle = calculateJointAngle(wrist, mcp, pip);
            const ipAngle = calculateJointAngle(mcp, pip, dip);
            
            const cmcBone = getBone('Thumb_CMC');
            const ipBone = getBone('Thumb_IP');
            
            if (cmcBone) {
                targetRotations['Thumb_CMC'] = { 
                    x: cmcAngle * 0.5, 
                    y: cmcBone.rotation.y * 0.8 + 0.3, 
                    z: cmcBone.rotation.z 
                };
            }
            if (ipBone) {
                targetRotations['Thumb_IP'] = { x: ipAngle, y: ipBone.rotation.y, z: ipBone.rotation.z };
            }
        } else {
            const mcpAngle = calculateJointAngle(wrist, mcp, pip);
            const pipAngle = calculateJointAngle(mcp, pip, dip);
            
            const mcpBone = getBone(`${f.name}_MCP`);
            const pipBone = getBone(`${f.name}_PIP`);
            const dipBone = getBone(`${f.name}_DIP`);
            
            if (mcpBone) {
                targetRotations[`${f.name}_MCP`] = { 
                    x: mcpAngle, 
                    y: mcpBone.rotation.y, 
                    z: mcpBone.rotation.z 
                };
            }
            if (pipBone) {
                targetRotations[`${f.name}_PIP`] = { 
                    x: pipAngle, 
                    y: pipBone.rotation.y, 
                    z: pipBone.rotation.z 
                };
            }
            if (dipBone) {
                targetRotations[`${f.name}_DIP`] = { 
                    x: pipAngle * 0.7, 
                    y: dipBone.rotation.y, 
                    z: dipBone.rotation.z 
                };
            }
        }
    }
}

/**
 * Apply smoothed rotations to bones
 */
function updateBoneRotations() {
    if (!roboticHand) return;
    
    const keys = Object.keys(targetRotations);
    for (let i = 0; i < keys.length; i++) {
        const boneName = keys[i];
        const bone = bones[boneName];
        const target = targetRotations[boneName];
        
        if (bone && target) {
            bone.rotation.x += (target.x - bone.rotation.x) * CONFIG.smoothFactor;
            bone.rotation.y += (target.y - bone.rotation.y) * CONFIG.smoothFactor;
            bone.rotation.z += (target.z - bone.rotation.z) * CONFIG.smoothFactor;
        }
    }
}

/**
 * Draw skeleton lines on canvas
 */
function drawSkeleton(landmarks) {
    canvasCtx.strokeStyle = '#00FF88';
    canvasCtx.lineWidth = 2;
    
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
        const [startIdx, endIdx] = HAND_CONNECTIONS[i];
        const start = landmarks[startIdx];
        const end = landmarks[endIdx];
        
        canvasCtx.beginPath();
        canvasCtx.moveTo(start.x * canvasElement.width, start.y * canvasElement.height);
        canvasCtx.lineTo(end.x * canvasElement.width, end.y * canvasElement.height);
        canvasCtx.stroke();
    }
}

/**
 * MediaPipe hands callback
 */
function onResults(results) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results.image) {
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    }
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        currentLandmarks = landmarks;
        
        // Draw skeleton lines
        drawSkeleton(landmarks);
        
        // Draw landmark dots
        canvasCtx.fillStyle = '#FF4444';
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            canvasCtx.beginPath();
            canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 4, 0, Math.PI * 2);
            canvasCtx.fill();
        }
        
        updateStatus('active', 'Tracking active');
        isTracking = true;
    } else {
        currentLandmarks = null;
        updateStatus('active', 'No hand detected');
        isTracking = false;
    }
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
    
    canvasElement.width = CONFIG.cameraWidth;
    canvasElement.height = CONFIG.cameraHeight;
    
    hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
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
    
    if (currentLandmarks) {
        mapLandmarksToBones(currentLandmarks);
    }
    
    updateBoneRotations();
    controls.update();
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