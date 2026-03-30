/**
 * Robotic Hand Tracker - Terminator Hand
 */

const CONFIG = {
    cameraWidth: 320,
    cameraHeight: 240,
    handConfidence: 0.5,
    trackingConfidence: 0.5,
    smoothFactor: 0.15,
    scaleFactor: 4
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
let armature = null;
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
    scene.background = new THREE.Color(0x0a0a0a);
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.25, 0.5);
    
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('three-canvas'), 
        antialias: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.05, 0);
    
    // Dramatic lighting for Terminator
    scene.add(new THREE.AmbientLight(0x404040, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0x4444ff, 0.5);
    rimLight.position.set(-5, 2, -5);
    scene.add(rimLight);
    scene.add(new THREE.GridHelper(2, 20, 0x333333, 0x111111));
    
    loadTerminatorHand();
    window.addEventListener('resize', onWindowResize);
    animate();
}

function loadTerminatorHand() {
    log('Loading Terminator hand...');
    const loader = new THREE.GLTFLoader();
    
    loader.load('terminator_hand.gltf', 
        (gltf) => {
            log('Terminator hand loaded');
            
            const model = gltf.scene;
            model.scale.set(CONFIG.scaleFactor, CONFIG.scaleFactor, CONFIG.scaleFactor);
            scene.add(model);
            
            // Find armature
            model.traverse((obj) => {
                if (obj.name === 'TerminatorHand_Armature') {
                    armature = obj;
                    log('Found armature: ' + obj.name);
                }
            });
            
            // Terminator hand mesh-to-bone mapping
            const meshToBoneMap = {
                // Index finger
                'Index_Proximal_Segment': 'Index_MCP',
                'Index_Proximal_Piston': 'Index_MCP',
                'Index_Middle_Segment': 'Index_PIP',
                'Index_Middle_Piston': 'Index_PIP',
                'Index_Distal_Segment': 'Index_DIP',
                // Middle
                'Middle_Proximal_Segment': 'Middle_MCP',
                'Middle_Proximal_Piston': 'Middle_MCP',
                'Middle_Middle_Segment': 'Middle_PIP',
                'Middle_Middle_Piston': 'Middle_PIP',
                'Middle_Distal_Segment': 'Middle_DIP',
                // Ring
                'Ring_Proximal_Segment': 'Ring_MCP',
                'Ring_Proximal_Piston': 'Ring_MCP',
                'Ring_Middle_Segment': 'Ring_PIP',
                'Ring_Middle_Piston': 'Ring_PIP',
                'Ring_Distal_Segment': 'Ring_DIP',
                // Pinky
                'Pinky_Proximal_Segment': 'Pinky_MCP',
                'Pinky_Proximal_Piston': 'Pinky_MCP',
                'Pinky_Middle_Segment': 'Pinky_PIP',
                'Pinky_Middle_Piston': 'Pinky_PIP',
                'Pinky_Distal_Segment': 'Pinky_DIP',
                // Thumb
                'Thumb_Proximal_Segment': 'Thumb_CMC',
                'Thumb_Proximal_Piston': 'Thumb_CMC',
                'Thumb_Distal_Segment': 'Thumb_IP',
                // Palm
                'Palm_Base': 'Palm',
                'Cube': 'Palm'
            };
            
            if (armature) {
                const meshes = {};
                
                armature.traverse((child) => {
                    const name = child.name;
                    
                    // Collect meshes to reparent
                    if (meshToBoneMap[name]) {
                        meshes[name] = child;
                    }
                    
                    // Collect bones
                    if (['Root', 'Palm', 'Index_MCP', 'Index_PIP', 'Index_DIP',
                         'Middle_MCP', 'Middle_PIP', 'Middle_DIP',
                         'Ring_MCP', 'Ring_PIP', 'Ring_DIP',
                         'Pinky_MCP', 'Pinky_PIP', 'Pinky_DIP',
                         'Thumb_CMC', 'Thumb_IP'].includes(name)) {
                        bones[name] = child;
                        targetRotations[name] = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z };
                    }
                });
                
                // Reparent meshes to bones
                for (let [meshName, boneName] of Object.entries(meshToBoneMap)) {
                    const mesh = meshes[meshName];
                    const bone = bones[boneName];
                    
                    if (mesh && bone) {
                        mesh.updateMatrixWorld();
                        const worldMatrix = mesh.matrixWorld.clone();
                        bone.add(mesh);
                        mesh.matrix.copy(worldMatrix);
                        mesh.matrix.decompose(mesh.position, mesh.rotation, mesh.scale);
                    }
                }
            }
            
            log(`Bones ready: ${Object.keys(bones).join(', ')}`);
            
            isModelLoaded = true;
            updateStatus('active', 'Terminator hand loaded - Start camera');
            const startBtn = document.getElementById('start-btn');
            if (startBtn) startBtn.disabled = false;
        },
        undefined,
        (error) => {
            log(`ERROR: ${error}`);
            updateStatus('error', 'Failed to load hand');
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
        bones['Root'].rotation.y = angleY;
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
            if (bones['Thumb_CMC']) bones['Thumb_CMC'].rotation.x = curlMCP * 0.5;
            if (bones['Thumb_IP']) bones['Thumb_IP'].rotation.x = curlPIP;
        } else {
            const mcpBone = bones[`${f.name}_MCP`];
            const pipBone = bones[`${f.name}_PIP`];
            const dipBone = bones[`${f.name}_DIP`];
            
            if (mcpBone) mcpBone.rotation.x = curlMCP;
            if (pipBone) pipBone.rotation.x = curlPIP;
            if (dipBone) dipBone.rotation.x = curlPIP * 0.8;
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    
    if (currentLandmarks && isModelLoaded) {
        mapLandmarksToBones(currentLandmarks);
        if (armature) armature.updateMatrixWorld(true);
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