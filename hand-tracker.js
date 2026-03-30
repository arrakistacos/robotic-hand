/**
 * Robotic Hand Tracker - Debug Version
 */

const CONFIG = {
    cameraWidth: 320,
    cameraHeight: 240,
    handConfidence: 0.5,
    trackingConfidence: 0.5,
    smoothFactor: 0.15,
    scaleFactor: 5
};

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20]
];

const LANDMARKS = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Bone name mapping - these are the actual armature control bones
const BONE_MAP = {
    'Root': 'Root',
    'Palm': 'Palm',
    'Index_MCP': 'Index_MCP',
    'Index_PIP': 'Index_PIP',
    'Index_DIP': 'Index_DIP',
    'Middle_MCP': 'Middle_MCP',
    'Middle_PIP': 'Middle_PIP',
    'Middle_DIP': 'Middle_DIP',
    'Ring_MCP': 'Ring_MCP',
    'Ring_PIP': 'Ring_PIP',
    'Ring_DIP': 'Ring_DIP',
    'Pinky_MCP': 'Pinky_MCP',
    'Pinky_PIP': 'Pinky_PIP',
    'Pinky_DIP': 'Pinky_DIP',
    'Thumb_CMC': 'Thumb_CMC',
    'Thumb_IP': 'Thumb_IP'
};

let scene, camera, renderer, controls;
let roboticHand = null;
let bones = {};
let targetRotations = {};
let currentLandmarks = null;
let hands;
let webcamElement, canvasElement, canvasCtx;
let isModelLoaded = false;

function log(msg) {
    console.log('[HandTracker]', msg);
}

function initThreeJS() {
    log('Initializing Three.js...');
    const container = document.getElementById('scene-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.3, 0.6);
    
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('three-canvas'), 
        antialias: true,
        alpha: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.1, 0);
    
    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(2, 20, 0x444444, 0x222222));
    
    loadRoboticHand();
    
    window.addEventListener('resize', onWindowResize);
    animate();
}

function loadRoboticHand() {
    log('Loading GLTF model...');
    const loader = new THREE.GLTFLoader();
    
    loader.load('robotic_hand.gltf', 
        (gltf) => {
            log('GLTF loaded successfully');
            roboticHand = gltf.scene;
            roboticHand.scale.set(CONFIG.scaleFactor, CONFIG.scaleFactor, CONFIG.scaleFactor);
            
            // Find all bones - GLTF skinned mesh bones are THREE.Bone objects
            const foundBones = [];
            roboticHand.traverse((child) => {
                // Check if it's a bone from the armature
                if (child.type === 'Bone' || child.isBone) {
                    foundBones.push(child.name);
                    bones[child.name] = child;
                    // Store initial rotation
                    targetRotations[child.name] = { 
                        x: child.rotation.x, 
                        y: child.rotation.y, 
                        z: child.rotation.z 
                    };
                }
            });
            
            log(`Found ${foundBones.length} bones: ${foundBones.join(', ')}`);
            
            // Check if our mapped bones exist
            for (let [key, boneName] of Object.entries(BONE_MAP)) {
                if (bones[boneName]) {
                    log(`✓ Mapped bone: ${key} -> ${boneName}`);
                } else {
                    log(`✗ Missing bone: ${boneName}`);
                }
            }
            
            scene.add(roboticHand);
            isModelLoaded = true;
            updateStatus('active', 'Model loaded - Start camera to track');
            document.getElementById('start-btn').disabled = false;
        },
        (progress) => {
            log(`Loading: ${(progress.loaded / progress.total * 100).toFixed(0)}%`);
        },
        (error) => {
            log(`ERROR loading GLTF: ${error}`);
            updateStatus('error', 'Failed to load model');
        }
    );
}

function calculateJointAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    if (len1 === 0 || len2 === 0) return 0;
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function mapLandmarksToBones(landmarks) {
    if (!isModelLoaded || !landmarks) return;
    
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    
    // Calculate and store angles
    let updatedBones = 0;
    
    // Root/Palm rotation
    if (bones[BONE_MAP.Root]) {
        const angleY = Math.atan2(middleMCP.x - wrist.x, middleMCP.z - wrist.z);
        targetRotations[BONE_MAP.Root] = { x: 0, y: angleY, z: 0 };
        updatedBones++;
    }
    
    // Map fingers
    const fingers = [
        { name: 'Index', mcp: LANDMARKS.INDEX_MCP, pip: LANDMARKS.INDEX_PIP, dip: LANDMARKS.INDEX_DIP },
        { name: 'Middle', mcp: LANDMARKS.MIDDLE_MCP, pip: LANDMARKS.MIDDLE_PIP, dip: LANDMARKS.MIDDLE_DIP },
        { name: 'Ring', mcp: LANDMARKS.RING_MCP, pip: LANDMARKS.RING_PIP, dip: LANDMARKS.RING_DIP },
        { name: 'Pinky', mcp: LANDMARKS.PINKY_MCP, pip: LANDMARKS.PINKY_PIP, dip: LANDMARKS.PINKY_DIP },
        { name: 'Thumb', mcp: LANDMARKS.THUMB_MCP, pip: LANDMARKS.THUMB_IP, dip: LANDMARKS.THUMB_TIP, isThumb: true }
    ];
    
    for (let f of fingers) {
        const mcp = landmarks[f.mcp];
        const pip = landmarks[f.pip];
        const dip = landmarks[f.dip];
        
        const mcpJoint = BONE_MAP[`${f.name}_MCP`];
        const pipJoint = f.isThumb ? BONE_MAP.Thumb_IP : BONE_MAP[`${f.name}_PIP`];
        const dipJoint = f.isThumb ? null : BONE_MAP[`${f.name}_DIP`];
        
        const curlMCP = calculateJointAngle(wrist, mcp, pip);
        const curlPIP = calculateJointAngle(mcp, pip, dip);
        
        if (mcpJoint && bones[mcpJoint]) {
            targetRotations[mcpJoint] = { x: curlMCP * (f.isThumb ? 0.5 : 1.0), y: 0, z: 0 };
            updatedBones++;
        }
        if (pipJoint && bones[pipJoint]) {
            targetRotations[pipJoint] = { x: curlPIP, y: 0, z: 0 };
            updatedBones++;
        }
        if (dipJoint && bones[dipJoint]) {
            targetRotations[dipJoint] = { x: curlPIP * 0.8, y: 0, z: 0 };
            updatedBones++;
        }
    }
    
    if (debugFrame % 60 === 0) {
        log(`Updated ${updatedBones} bone targets`);
    }
}

let debugFrame = 0;

function updateBoneRotations() {
    if (!isModelLoaded) return;
    
    debugFrame++;
    if (debugFrame % 60 === 0) {
        log(`Animation frame ${debugFrame}, currentLandmarks: ${currentLandmarks ? 'YES' : 'NO'}`);
        if (currentLandmarks) {
            const mcp = bones['Index_MCP'];
            if (mcp) {
                log(`Index_MCP rotation: x=${mcp.rotation.x.toFixed(2)}, target=${targetRotations['Index_MCP']?.x.toFixed(2)}`);
            }
        }
    }
    
    for (let name in targetRotations) {
        const bone = bones[name];
        const target = targetRotations[name];
        if (bone && target) {
            bone.rotation.x += (target.x - bone.rotation.x) * CONFIG.smoothFactor;
            bone.rotation.y += (target.y - bone.rotation.y) * CONFIG.smoothFactor;
            bone.rotation.z += (target.z - bone.rotation.z) * CONFIG.smoothFactor;
        }
    }
}

function drawSkeleton(landmarks) {
    canvasCtx.strokeStyle = '#00FF88';
    canvasCtx.lineWidth = 2;
    for (let [a, b] of HAND_CONNECTIONS) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(landmarks[a].x * canvasElement.width, landmarks[a].y * canvasElement.height);
        canvasCtx.lineTo(landmarks[b].x * canvasElement.width, landmarks[b].y * canvasElement.height);
        canvasCtx.stroke();
    }
}

function onResults(results) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results.image) {
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    }
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        currentLandmarks = landmarks;
        
        drawSkeleton(landmarks);
        
        canvasCtx.fillStyle = '#FF4444';
        for (let lm of landmarks) {
            canvasCtx.beginPath();
            canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 4, 0, Math.PI * 2);
            canvasCtx.fill();
        }
        
        updateStatus('active', 'Tracking active');
    } else {
        currentLandmarks = null;
        updateStatus('active', 'No hand detected');
    }
}

function updateStatus(cls, msg) {
    const el = document.getElementById('status');
    if (el) {
        el.className = cls;
        el.textContent = msg;
    }
}

function initMediaPipe() {
    log('Initializing MediaPipe...');
    webcamElement = document.getElementById('webcam');
    canvasElement = document.getElementById('canvas-overlay');
    canvasCtx = canvasElement.getContext('2d');
    canvasElement.width = CONFIG.cameraWidth;
    canvasElement.height = CONFIG.cameraHeight;
    
    hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: CONFIG.handConfidence,
        minTrackingConfidence: CONFIG.trackingConfidence
    });
    
    hands.onResults(onResults);
    updateStatus('active', 'Ready - Click Start Camera');
}

async function startCamera() {
    log('Starting camera...');
    const camera = new Camera(webcamElement, {
        onFrame: async () => {
            await hands.send({image: webcamElement});
        },
        width: CONFIG.cameraWidth,
        height: CONFIG.cameraHeight
    });
    
    try {
        await camera.start();
        log('Camera started');
        document.getElementById('start-btn').textContent = 'Camera Active';
        document.getElementById('start-btn').disabled = true;
    } catch (e) {
        log(`Camera error: ${e}`);
        updateStatus('error', 'Camera access denied');
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    // Check if we have landmarks to process
    if (currentLandmarks && isModelLoaded) {
        mapLandmarksToBones(currentLandmarks);
    }
    
    // Apply rotations to bones
    updateBoneRotations();
    
    // Update controls and render
    controls.update();
    renderer.render(scene, camera);
}

// Start animation immediately
log('Animation loop started');

function onWindowResize() {
    const container = document.getElementById('scene-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

document.addEventListener('DOMContentLoaded', () => {
    log('DOM loaded, starting...');
    initThreeJS();
    initMediaPipe();
    document.getElementById('start-btn').addEventListener('click', startCamera);
});