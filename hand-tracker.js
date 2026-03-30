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
    smoothFactor: 0.15,
    scaleFactor: 5
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

// Landmark indices
const LANDMARKS = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Pre-allocate vectors to avoid GC
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
    renderer.shadowMap.enabled = false; // Disable shadows for performance
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    
    // Simplified lighting
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
        
        roboticHand.traverse((child) => {
            if (child.isBone) {
                bones[child.name] = child;
                targetRotations[child.name] = { x: 0, y: 0, z: 0 };
            }
        });
        
        console.log('Loaded bones:', Object.keys(bones).length);
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
 * Map MediaPipe landmarks to robotic hand bone rotations
 * Optimized to minimize object creation
 */
function mapLandmarksToBones(landmarks) {
    if (!roboticHand || Object.keys(bones).length === 0) return;
    
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    
    // Simple wrist rotation
    if (bones['Root']) {
        const angleY = Math.atan2(middleMCP.x - wrist.x, middleMCP.y - wrist.y);
        targetRotations['Root'] = {
            x: 0,
            y: angleY + Math.PI,
            z: 0
        };
    }
    
    // Map fingers - simplified calculations
    const fingers = [
        { name: 'INDEX', mcp: LANDMARKS.INDEX_MCP, pip: LANDMARKS.INDEX_PIP, 
          dip: LANDMARKS.INDEX_DIP },
        { name: 'MIDDLE', mcp: LANDMARKS.MIDDLE_MCP, pip: LANDMARKS.MIDDLE_PIP,
          dip: LANDMARKS.MIDDLE_DIP },
        { name: 'RING', mcp: LANDMARKS.RING_MCP, pip: LANDMARKS.RING_PIP,
          dip: LANDMARKS.RING_DIP },
        { name: 'PINKY', mcp: LANDMARKS.PINKY_MCP, pip: LANDMARKS.PINKY_PIP,
          dip: LANDMARKS.PINKY_DIP },
        { name: 'THUMB', mcp: LANDMARKS.THUMB_MCP, pip: LANDMARKS.THUMB_IP,
          dip: LANDMARKS.THUMB_TIP, isThumb: true }
    ];
    
    for (let i = 0; i < fingers.length; i++) {
        const f = fingers[i];
        const mcp = landmarks[f.mcp];
        const pip = landmarks[f.pip];
        const dip = landmarks[f.dip];
        
        if (f.isThumb) {
            const cmcAngle = calculateJointAngle(wrist, mcp, pip);
            const ipAngle = calculateJointAngle(mcp, pip, dip);
            
            if (bones['Thumb_CMC']) {
                targetRotations['Thumb_CMC'] = { x: cmcAngle * 0.6, y: 0.4, z: 0 };
            }
            if (bones['Thumb_IP']) {
                targetRotations['Thumb_IP'] = { x: ipAngle, y: 0, z: 0 };
            }
        } else {
            const mcpAngle = calculateJointAngle(wrist, mcp, pip);
            const pipAngle = calculateJointAngle(mcp, pip, dip);
            
            const mcpBone = bones[`${f.name}_MCP`];
            const pipBone = bones[`${f.name}_PIP`];
            const dipBone = bones[`${f.name}_DIP`];
            
            if (mcpBone) targetRotations[`${f.name}_MCP`] = { x: mcpAngle, y: 0, z: 0 };
            if (pipBone) targetRotations[`${f.name}_PIP`] = { x: pipAngle, y: 0, z: 0 };
            if (dipBone) targetRotations[`${f.name}_DIP`] = { x: pipAngle * 0.8, y: 0, z: 0 };
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
 * MediaPipe hands callback - minimal work here
 */
function onResults(results) {
    // Clear and draw frame
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results.image) {
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    }
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        currentLandmarks = landmarks;
        
        // Draw simple dots only - no connectors
        canvasCtx.fillStyle = '#00FF88';
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            canvasCtx.beginPath();
            canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 3, 0, Math.PI * 2);
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
        modelComplexity: 0, // 0 = lightweight for performance
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
    
    // Process landmarks in animation frame, not in MediaPipe callback
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