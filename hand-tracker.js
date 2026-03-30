/**
 * Robotic Hand Tracker - Fixed for Rigid Hierarchy
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
    WRIST: 0, THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

let scene, camera, renderer, controls;
let armature = null;  // The actual armature object
let bones = {};       // Map of bone names to bone objects
let targetRotations = {};
let currentLandmarks = null;
let hands;
let webcamElement, canvasElement, canvasCtx;
let isModelLoaded = false;
let debugFrame = 0;

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
        antialias: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.1, 0);
    
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
    log('Loading GLTF...');
    const loader = new THREE.GLTFLoader();
    
    loader.load('robotic_hand.gltf', 
        (gltf) => {
            log('GLTF loaded');
            
            // Add entire scene
            const model = gltf.scene;
            model.scale.set(CONFIG.scaleFactor, CONFIG.scaleFactor, CONFIG.scaleFactor);
            scene.add(model);
            
            // Find the armature - it's named "RoboticHand_Armature"
            model.traverse((obj) => {
                if (obj.name === 'RoboticHand_Armature') {
                    armature = obj;
                    log('Found armature: ' + obj.name);
                }
            });
            
            // Find all bones - they're children of the armature
            if (armature) {
                armature.traverse((child) => {
                    // Bones have type "Bone" or are part of the armature hierarchy
                    if (child.isBone || child.type === 'Bone') {
                        const name = child.name;
                        bones[name] = child;
                        targetRotations[name] = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z };
                        log(`Found bone: ${name} at rotation x=${child.rotation.x.toFixed(2)}`);
                    }
                });
            }
            
            log(`Total bones found: ${Object.keys(bones).length}`);
            
            // Check for control bones
            const controlBones = ['Root', 'Palm', 'Index_MCP', 'Index_PIP', 'Index_DIP', 
                                  'Middle_MCP', 'Middle_PIP', 'Middle_DIP',
                                  'Ring_MCP', 'Ring_PIP', 'Ring_DIP',
                                  'Pinky_MCP', 'Pinky_PIP', 'Pinky_DIP',
                                  'Thumb_CMC', 'Thumb_IP'];
            
            controlBones.forEach(name => {
                if (bones[name]) {
                    log(`✓ Control bone ready: ${name}`);
                } else {
                    log(`✗ Missing control bone: ${name}`);
                }
            });
            
            isModelLoaded = true;
            updateStatus('active', 'Model loaded - Start camera');
            const startBtn = document.getElementById('start-btn');
            if (startBtn) startBtn.disabled = false;
        },
        undefined,
        (error) => {
            log(`ERROR: ${error}`);
            updateStatus('error', 'Failed to load model');
        }
    );
}

function calculateJointAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const len1 = Math.sqrt(v1.x**2 + v1.y**2 + v1.z**2);
    const len2 = Math.sqrt(v2.x**2 + v2.y**2 + v2.z**2);
    if (len1 === 0 || len2 === 0) return 0;
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function mapLandmarksToBones(landmarks) {
    if (!isModelLoaded || !armature) return;
    
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    
    // Wrist rotation
    if (bones['Root']) {
        const angleY = Math.atan2(middleMCP.x - wrist.x, middleMCP.z - wrist.z);
        // Apply rotation around Y axis
        bones['Root'].rotation.y = angleY;
        bones['Root'].rotation.x = 0;
        bones['Root'].rotation.z = 0;
    }
    
    // Finger mappings
    const fingers = [
        { name: 'Index', mcp: 5, pip: 6, dip: 7 },
        { name: 'Middle', mcp: 9, pip: 10, dip: 11 },
        { name: 'Ring', mcp: 13, pip: 14, dip: 15 },
        { name: 'Pinky', mcp: 17, pip: 18, dip: 19 },
        { name: 'Thumb', mcp: 2, pip: 3, dip: 4, isThumb: true }
    ];
    
    fingers.forEach(f => {
        const mcp = landmarks[f.mcp];
        const pip = landmarks[f.pip];
        const dip = landmarks[f.dip];
        
        const curlMCP = calculateJointAngle(wrist, mcp, pip);
        const curlPIP = calculateJointAngle(mcp, pip, dip);
        
        if (f.isThumb) {
            // Thumb uses CMC and IP
            if (bones['Thumb_CMC']) bones['Thumb_CMC'].rotation.x = curlMCP * 0.5;
            if (bones['Thumb_IP']) bones['Thumb_IP'].rotation.x = curlPIP;
        } else {
            // Standard fingers
            const mcpBone = bones[`${f.name}_MCP`];
            const pipBone = bones[`${f.name}_PIP`];
            const dipBone = bones[`${f.name}_DIP`];
            
            if (mcpBone) {
                mcpBone.rotation.x = curlMCP;
                mcpBone.rotation.y = 0;
                mcpBone.rotation.z = 0;
            }
            if (pipBone) {
                pipBone.rotation.x = curlPIP;
                pipBone.rotation.y = 0;
                pipBone.rotation.z = 0;
            }
            if (dipBone) {
                dipBone.rotation.x = curlPIP * 0.8;
                dipBone.rotation.y = 0;
                dipBone.rotation.z = 0;
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    
    if (currentLandmarks && isModelLoaded) {
        mapLandmarksToBones(currentLandmarks);
    }
    
    // Update armature matrices
    if (armature) {
        armature.updateMatrixWorld(true);
    }
    
    controls.update();
    renderer.render(scene, camera);
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
    
    if (!hands) {
        updateStatus('error', 'MediaPipe not ready');
        return;
    }
    
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
    } catch (e) {
        log(`Camera error: ${e}`);
        updateStatus('error', 'Camera access denied');
    }
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

document.addEventListener('DOMContentLoaded', () => {
    log('DOM loaded');
    initThreeJS();
    initMediaPipe();
    
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startCamera);
    }
});