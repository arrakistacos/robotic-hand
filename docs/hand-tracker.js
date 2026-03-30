/**
 * Robotic Hand Tracker
 */

const CONFIG = {
    cameraWidth: 320,
    cameraHeight: 240,
    handConfidence: 0.5,
    trackingConfidence: 0.5,
    smoothFactor: 0.2,
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
let roboticHand = null;
let bones = {};
let targetRotations = {};
let currentLandmarks = null;
let hands;
let webcamElement, canvasElement, canvasCtx;

function initThreeJS() {
    const container = document.getElementById('scene-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 0.5);
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas'), antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
    scene.add(new THREE.GridHelper(2, 20, 0x444444, 0x222222));
    loadRoboticHand();
    window.addEventListener('resize', onWindowResize);
    animate();
}

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
        console.log('Bones:', Object.keys(bones));
        scene.add(roboticHand);
        updateStatus('active', 'Hand loaded - Start camera');
        document.getElementById('start-btn').disabled = false;
    });
}

function calculateJointAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function mapLandmarksToBones(landmarks) {
    if (!roboticHand || Object.keys(bones).length === 0) return;
    const wrist = landmarks[LANDMARKS.WRIST];
    const middleMCP = landmarks[LANDMARKS.MIDDLE_MCP];
    if (bones['Root']) {
        const angleY = Math.atan2(middleMCP.x - wrist.x, middleMCP.y - wrist.y);
        targetRotations['Root'] = { x: 0, y: angleY + Math.PI, z: 0 };
    }
    const fingers = [
        { name: 'Index', mcp: LANDMARKS.INDEX_MCP, pip: LANDMARKS.INDEX_PIP, dip: LANDMARKS.INDEX_DIP },
        { name: 'Middle', mcp: LANDMARKS.MIDDLE_MCP, pip: LANDMARKS.MIDDLE_PIP, dip: LANDMARKS.MIDDLE_DIP },
        { name: 'Ring', mcp: LANDMARKS.RING_MCP, pip: LANDMARKS.RING_PIP, dip: LANDMARKS.RING_DIP },
        { name: 'Pinky', mcp: LANDMARKS.PINKY_MCP, pip: LANDMARKS.PINKY_PIP, dip: LANDMARKS.PINKY_DIP },
        { name: 'Thumb', mcp: LANDMARKS.THUMB_MCP, pip: LANDMARKS.THUMB_IP, dip: LANDMARKS.THUMB_TIP, isThumb: true }
    ];
    for (let f of fingers) {
        const mcp = landmarks[f.mcp], pip = landmarks[f.pip], dip = landmarks[f.dip];
        if (f.isThumb) {
            const cmc = calculateJointAngle(wrist, mcp, pip);
            const ip = calculateJointAngle(mcp, pip, dip);
            if (bones['Thumb_MCP_Joint']) targetRotations['Thumb_MCP_Joint'] = { x: cmc * 0.5, y: 0.3, z: 0 };
            if (bones['Thumb_IP_Joint']) targetRotations['Thumb_IP_Joint'] = { x: ip, y: 0, z: 0 };
        } else {
            const mcpAngle = calculateJointAngle(wrist, mcp, pip);
            const pipAngle = calculateJointAngle(mcp, pip, dip);
            if (bones[`${f.name}_MCP_Joint`]) targetRotations[`${f.name}_MCP_Joint`] = { x: mcpAngle, y: 0, z: 0 };
            if (bones[`${f.name}_PIP_Joint`]) targetRotations[`${f.name}_PIP_Joint`] = { x: pipAngle, y: 0, z: 0 };
            if (bones[`${f.name}_DIP_Joint`]) targetRotations[`${f.name}_DIP_Joint`] = { x: pipAngle * 0.7, y: 0, z: 0 };
        }
    }
}

function updateBoneRotations() {
    if (!roboticHand) return;
    for (let name in targetRotations) {
        const bone = bones[name], target = targetRotations[name];
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
    if (results.image) canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
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
    el.className = cls;
    el.textContent = msg;
}

function initMediaPipe() {
    webcamElement = document.getElementById('webcam');
    canvasElement = document.getElementById('canvas-overlay');
    canvasCtx = canvasElement.getContext('2d');
    canvasElement.width = CONFIG.cameraWidth;
    canvasElement.height = CONFIG.cameraHeight;
    hands = new Hands({locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`});
    hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: CONFIG.handConfidence, minTrackingConfidence: CONFIG.trackingConfidence });
    hands.onResults(onResults);
    updateStatus('active', 'Ready - Click Start Camera');
}

async function startCamera() {
    const camera = new Camera(webcamElement, { onFrame: async () => await hands.send({image: webcamElement}), width: CONFIG.cameraWidth, height: CONFIG.cameraHeight });
    try {
        await camera.start();
        document.getElementById('start-btn').textContent = 'Camera Active';
        document.getElementById('start-btn').disabled = true;
    } catch (e) {
        updateStatus('error', 'Camera access denied');
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (currentLandmarks) mapLandmarksToBones(currentLandmarks);
    updateBoneRotations();
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

document.addEventListener('DOMContentLoaded', () => {
    initThreeJS();
    initMediaPipe();
    document.getElementById('start-btn').addEventListener('click', startCamera);
});