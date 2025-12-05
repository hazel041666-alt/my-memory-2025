import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

// -----------------------------------------------------------------------------
// 1. 资源生成与工具函数
// -----------------------------------------------------------------------------

// 模拟拍立得纹理生成器
const createPolaroidTexture = (content: string | HTMLImageElement, color: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 300; 
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  ctx.fillStyle = '#fdfdfd';
  ctx.fillRect(0, 0, 256, 300);
  
  ctx.shadowColor = "rgba(0,0,0,0.15)";
  ctx.shadowBlur = 15;
  
  ctx.fillStyle = color;
  ctx.fillRect(20, 20, 216, 216);
  ctx.shadowBlur = 0;

  if (typeof content === 'string') {
    ctx.font = 'bold 40px "Impact", sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(content, 128, 128); 
    
    ctx.font = '20px "Courier New", monospace';
    ctx.fillStyle = '#666';
    ctx.fillText("2025", 128, 270);
  } else {
    const aspect = content.width / content.height;
    let sw = content.width;
    let sh = content.height;
    let sx = 0, sy = 0;
    
    if (aspect > 1) { 
      sw = content.height;
      sx = (content.width - content.height) / 2;
    } else { 
      sh = content.width;
      sy = (content.height - content.width) / 2;
    }
    ctx.drawImage(content, sx, sy, sw, sh, 20, 20, 216, 216);
    
    ctx.font = '16px "Courier New", monospace';
    ctx.fillStyle = '#444';
    ctx.fillText("My Memory", 128, 270);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

// 简单的几何体合并工具函数
const mergeBufferGeometries = (geometries: THREE.BufferGeometry[]) => {
  let vertexCount = 0;
  let indexCount = 0;
  
  geometries.forEach(g => {
    vertexCount += g.attributes.position.count;
    if (g.index) indexCount += g.index.count;
  });

  const positionArray = new Float32Array(vertexCount * 3);
  const normalArray = new Float32Array(vertexCount * 3);
  const uvArray = new Float32Array(vertexCount * 2);
  const colorArray = new Float32Array(vertexCount * 3); 
  const indexArray = indexCount > 0 ? new Uint32Array(indexCount) : null;

  let vOffset = 0;
  let iOffset = 0;

  geometries.forEach(g => {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    const col = g.attributes.color; 
    
    positionArray.set(pos.array, vOffset * 3);
    if (norm) normalArray.set(norm.array, vOffset * 3);
    if (uv) uvArray.set(uv.array, vOffset * 2);
    if (col) colorArray.set(col.array, vOffset * 3);

    if (g.index && indexArray) {
      for (let i = 0; i < g.index.count; i++) {
        indexArray[iOffset + i] = g.index.getX(i) + vOffset;
      }
      iOffset += g.index.count;
    }
    
    vOffset += pos.count;
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(colorArray, 3)); 
  if (indexArray) merged.setIndex(new THREE.BufferAttribute(indexArray, 1));
  
  return merged;
};

// 生成文字 "2025" 的点阵坐标
const generateTextLayout = (text: string, count: number): THREE.Vector3[] => {
  const canvas = document.createElement('canvas');
  const width = 1024;
  const height = 512;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  
  ctx.font = 'bold 320px "Verdana", "Arial", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const textString = text.split('').join(String.fromCharCode(8202)); 
  ctx.fillText(textString, width / 2, height / 2);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  let points: THREE.Vector3[] = [];

  const step = 4; 

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      if (data[index] > 100) { 
        const pX = (x / width - 0.5) * 75; 
        const pY = -(y / height - 0.5) * 35; 
        points.push(new THREE.Vector3(pX, pY, 0));
      }
    }
  }
  
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }

  const result: THREE.Vector3[] = [];
  if (points.length === 0) return Array(count).fill(new THREE.Vector3());

  for (let i = 0; i < count; i++) {
    const p = points[i % points.length];
    result.push(new THREE.Vector3(
      p.x + (Math.random() - 0.5) * 0.1, 
      p.y + (Math.random() - 0.5) * 0.1, 
      (Math.random() - 0.5) * 0.1        
    ));
  }
  
  return result;
};

// -----------------------------------------------------------------------------
// 2. 常量定义
// -----------------------------------------------------------------------------
const STAR_COUNT = 5000;
const PHOTO_COUNT = 150; 
const DECO_COUNT = 250;  
const TOTAL_ITEMS = PHOTO_COUNT + DECO_COUNT;

// -----------------------------------------------------------------------------
// 3. 着色器
// -----------------------------------------------------------------------------

const starVertexShader = `
  uniform float uTime;
  uniform float uProgress;
  attribute vec3 aPositionChaos;
  attribute vec3 aPositionFormed;
  attribute float aSize;
  attribute float aRandom;
  varying float vAlpha;
  
  float easeInOutQuint(float x) {
    return x < 0.5 ? 16.0 * x * x * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 5.0) / 2.0;
  }

  void main() {
    float t = easeInOutQuint(uProgress);
    vec3 floating = vec3(
      sin(uTime * 0.5 + aRandom * 55.0) * 0.05,
      cos(uTime * 0.3 + aRandom * 35.0) * 0.05,
      sin(uTime * 0.4 + aRandom * 15.0) * 0.02
    ) * mix(1.0, 0.0, t); 

    vec3 pos = mix(aPositionChaos, aPositionFormed, t);
    vec4 mvPosition = modelViewMatrix * vec4(pos + floating, 1.0);
    
    float twinkleBase = sin(uTime * (3.0 + aRandom * 5.0) + aRandom * 100.0);
    twinkleBase = smoothstep(-0.5, 1.0, twinkleBase) * 0.5 + 0.5; 
    float finalTwinkle = mix(twinkleBase, 1.0, t);

    float stateScale = mix(1.0, 0.8, t); 
    gl_PointSize = aSize * stateScale * finalTwinkle * (450.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = aRandom; 
  }
`;

const starFragmentShader = `
  uniform vec3 uColorMain;
  uniform vec3 uColorSub;
  varying float vAlpha;

  void main() {
    vec2 uv = 2.0 * gl_PointCoord - 1.0;
    float dist = length(uv);
    float core = smoothstep(0.05, 0.0, dist);
    float glow = exp(-dist * dist * 50.0); 
    float strength = core * 3.0 + glow * 0.5;
    vec3 color = mix(uColorSub, uColorMain, vAlpha * 0.8 + 0.2);
    color = mix(color, vec3(1.0), core * 0.8); 
    
    float alpha = strength * vAlpha;
    if (alpha < 0.01) discard; 
    
    gl_FragColor = vec4(color, min(1.0, alpha * 1.5)); 
  }
`;

const decoVertexShader = `
  uniform float uTime;
  uniform float uProgress;
  attribute vec3 aPosChaos;
  attribute vec3 aPosFormed;
  attribute vec3 aRandomVec; 
  attribute float aRandom;   
  attribute vec3 color; 
  
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vRandomVal;
  varying vec3 vColor; 

  float easeOutQuart(float x) {
    return 1.0 - pow(1.0 - x, 4.0);
  }

  mat4 rotationMatrix(vec3 axis, float angle) {
      axis = normalize(axis);
      float s = sin(angle);
      float c = cos(angle);
      float oc = 1.0 - c;
      return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                  oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                  oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                  0.0,                                0.0,                                0.0,                                1.0);
  }

  void main() {
    float t = easeOutQuart(uProgress);
    vRandomVal = aRandom;
    vColor = color; 

    vec3 pos = mix(aPosChaos, aPosFormed, t);
    
    vec3 floating = vec3(
      sin(uTime * 0.5 + aRandom * 20.0),
      cos(uTime * 0.3 + aRandom * 30.0),
      sin(uTime * 0.4 + aRandom * 40.0)
    ) * 0.2; 
    
    float rotSpeed = mix(2.0, 0.5, t); 
    float angle = uTime * rotSpeed * 0.5 + aRandom * 10.0;
    mat4 rotMat = rotationMatrix(aRandomVec, angle);
    
    vNormal = normalize((rotMat * vec4(normal, 0.0)).xyz);
    vec3 transformed = (rotMat * vec4(position, 1.0)).xyz;
    
    float scale = mix(0.0, 1.0, smoothstep(0.0, 0.2, uProgress + aRandom * 0.2));
    scale = mix(1.0, scale, t);

    vec4 mvPosition = modelViewMatrix * vec4(pos + floating + transformed * scale, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const decoFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vRandomVal;
  varying vec3 vColor; 

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    vec3 lightDir = normalize(vec3(0.5, 1.0, 1.0)); 

    float diff = max(dot(normal, lightDir), 0.0);
    
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    float reflection = pow(max(dot(reflect(-viewDir, normal), vec3(0.0, 1.0, 0.0)), 0.0), 2.0);

    vec3 color = vColor; 
    vec3 lighting = color * (0.3 + diff * 0.5) 
                  + vec3(1.0) * spec * 0.6 
                  + color * fresnel * 0.4
                  + vec3(1.0, 1.0, 0.9) * reflection * 0.2;

    gl_FragColor = vec4(lighting, 1.0);
  }
`;

const photoVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const photoFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    if (texColor.a < 0.1) discard; 
    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity);
  }
`;

// -----------------------------------------------------------------------------
// 4. 主程序
// -----------------------------------------------------------------------------
export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // App State
  const [isFormed, setFormed] = useState(false);
  const isFormedRef = useRef(isFormed);
  const mouseRef = useRef({ x: 0, y: 0 }); 
  
  // UI State for Carousel Navigation
  const [uiActiveId, setUiActiveId] = useState<number>(-1);

  // Camera & Gesture
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const cameraActiveRef = useRef(false);
  
  const [modelLoaded, setModelLoaded] = useState(false);
  const [gestureStatus, setGestureStatus] = useState<string>('None');
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const lastVideoTimeRef = useRef(-1);
  
  // Photos State
  const [userTextures, setUserTextures] = useState<THREE.Texture[]>([]);
  const [sceneReady, setSceneReady] = useState(false);

  // Interaction State
  const interactionState = useRef({
    isPinching: false,
    handPos: new THREE.Vector2(0, 0),
    activePhotoId: -1,
    grabbedPhotoId: -1,
    lastPinchStatus: false,
    pinchStartTime: 0,
    lastTapTime: 0,
    hoveredPhotoId: -1
  });

  // Tap Detection Ref
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });

  // Helper to update active photo safely and sync UI
  const setActivePhoto = (id: number) => {
    interactionState.current.activePhotoId = id;
    setUiActiveId(id);
  };

  // Carousel Handlers
  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent raycasting click
    let nextId = interactionState.current.activePhotoId;
    if (nextId === -1) return;
    // Find next valid photo (skip decos if any mixed, though currently 0-149 are photos)
    // Simple increment loop
    nextId = (nextId + 1) % PHOTO_COUNT;
    setActivePhoto(nextId);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    let prevId = interactionState.current.activePhotoId;
    if (prevId === -1) return;
    prevId = (prevId - 1 + PHOTO_COUNT) % PHOTO_COUNT;
    setActivePhoto(prevId);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePhoto(-1);
  };

  useEffect(() => { 
    isFormedRef.current = isFormed; 
  }, [isFormed]);

  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);

  useEffect(() => {
    let isMounted = true;
    const loadModel = async () => {
      try {
        console.log("Loading MediaPipe Vision...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        if (!isMounted) return;
        
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        
        if (isMounted) {
          gestureRecognizerRef.current = recognizer;
          setModelLoaded(true);
          console.log("MediaPipe Model Loaded");
        }
      } catch(e) { 
        console.error("MediaPipe Load Error:", e);
        if (isMounted) setModelLoaded(false);
      }
    };
    loadModel();
    return () => { isMounted = false; };
  }, []);

  const enableCam = async () => {
    if (!gestureRecognizerRef.current) { 
        if (!modelLoaded) alert("AI Model is still loading... Please wait.");
        return; 
    }
    
    if (cameraActive) {
      setCameraActive(false);
      setFormed(false);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadeddata', () => {
             if (videoRef.current) videoRef.current.play(); 
             setCameraActive(true);
          });
        }
      } catch(e) { 
        console.error(e);
        alert("Unable to access camera. Please allow permissions."); 
      }
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newTextures: THREE.Texture[] = [];
      let loadedCount = 0;

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const colors = ['#ff9a9e', '#a18cd1', '#fad0c4', '#fbc2eb', '#a6c1ee'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            const tex = createPolaroidTexture(img, randomColor);
            newTextures.push(tex);
            loadedCount++;
            
            if (loadedCount === files.length) {
              setUserTextures(prev => [...prev, ...newTextures]); 
              setSceneReady(prev => !prev); 
            }
          };
          img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Init Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020408');
    scene.fog = new THREE.Fog('#020408', 20, 200); 

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    
    // 自适应摄像机距离
    const updateCameraDistance = () => {
        const aspect = window.innerWidth / window.innerHeight;
        const targetWidth = 75; 
        const fovRad = (45 * Math.PI) / 180;
        let dist = targetWidth / (2 * Math.tan(fovRad / 2) * aspect);
        dist = Math.max(35, dist);
        camera.position.set(0, 0, dist);
        camera.lookAt(0, 0, 0);
    };
    updateCameraDistance();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1.0 };

    // 2. Generate "2025" Positions
    const textTargetPositions = generateTextLayout("2025", TOTAL_ITEMS);

    // 3. Stars (Background)
    const starGeo = new THREE.BufferGeometry();
    const sPosChaos = new Float32Array(STAR_COUNT * 3);
    const sPosFormed = new Float32Array(STAR_COUNT * 3);
    const sSizes = new Float32Array(STAR_COUNT);
    const sRandoms = new Float32Array(STAR_COUNT);
    
    for(let i=0; i<STAR_COUNT; i++) {
        const r = 80 * Math.cbrt(Math.random()); 
        const theta = Math.random()*Math.PI*2; 
        const phi = Math.acos(2*Math.random()-1);
        sPosChaos[i*3] = r*Math.sin(phi)*Math.cos(theta); 
        sPosChaos[i*3+1] = r*Math.sin(phi)*Math.sin(theta); 
        sPosChaos[i*3+2] = r*Math.cos(phi);

        const target = textTargetPositions[i % textTargetPositions.length];
        const angle = Math.random() * Math.PI * 2;
        const dist = 3.0 + Math.random() * 8.0; 
        sPosFormed[i*3] = target.x + Math.cos(angle) * dist;
        sPosFormed[i*3+1] = target.y + Math.sin(angle) * dist;
        sPosFormed[i*3+2] = target.z + (Math.random()-0.5) * 5.0;

        sSizes[i] = 1.5 + Math.random() * 2.5; 
        sRandoms[i] = Math.random();
    }

    starGeo.setAttribute('aPositionChaos', new THREE.BufferAttribute(sPosChaos, 3));
    starGeo.setAttribute('aPositionFormed', new THREE.BufferAttribute(sPosFormed, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSizes, 1));
    starGeo.setAttribute('aRandom', new THREE.BufferAttribute(sRandoms, 1));
    starGeo.setAttribute('position', new THREE.BufferAttribute(sPosChaos, 3)); 

    const starMat = new THREE.ShaderMaterial({
      vertexShader: starVertexShader, fragmentShader: starFragmentShader,
      uniforms: { uTime: { value: 0 }, uProgress: { value: 0 }, uColorMain: { value: new THREE.Color('#FFF5D0') }, uColorSub: { value: new THREE.Color('#4B70AE') } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false; 
    scene.add(stars);

    // 4. Photos & Decorations (Meshes)
    const defaultPhotoTextures = [
      createPolaroidTexture('2025', '#ff9a9e'),
      createPolaroidTexture('HOPE', '#a18cd1'),
      createPolaroidTexture('DREAM', '#fad0c4'),
      createPolaroidTexture('JOY', '#fbc2eb'),
      createPolaroidTexture('LIFE', '#a6c1ee'),
    ];
    
    const activePhotoTextures = userTextures.length > 0 ? userTextures : defaultPhotoTextures;
    
    const objects: any[] = [];
    const meshes: THREE.Mesh[] = [];

    // --- 辅助函数：设置几何体颜色 ---
    const setGeometryColor = (geometry: THREE.BufferGeometry, color: THREE.Color) => {
        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    };

    // --- 立体装饰几何体生成 ---
    
    // 1. 五角星
    const createStarGeo = () => {
      const shape = new THREE.Shape();
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const l = i % 2 === 0 ? 0.6 : 0.25;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI/2;
        const x = Math.cos(a) * l;
        const y = Math.sin(a) * l;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
      geom.center();
      return geom.toNonIndexed();
    };
    
    // 2. 礼物盒
    const createGiftGeo = () => {
        const colGoldBox = new THREE.Color('#FFD700'); 
        const colRedRibbon = new THREE.Color('#D62828'); 

        const boxGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7).toNonIndexed();
        setGeometryColor(boxGeo, colGoldBox); 

        const ribbon1 = new THREE.BoxGeometry(0.75, 0.75, 0.2).toNonIndexed();
        setGeometryColor(ribbon1, colRedRibbon);
        
        const ribbon2 = new THREE.BoxGeometry(0.2, 0.75, 0.75).toNonIndexed();
        setGeometryColor(ribbon2, colRedRibbon);
        
        const geometries = [boxGeo, ribbon1, ribbon2];
        const merged = mergeBufferGeometries(geometries);
        merged.center();
        return merged;
    };
    
    // 3. 雪花
    const createSnowGeo = () => {
        const barGeo = new THREE.BoxGeometry(0.08, 0.9, 0.05).toNonIndexed();
        const forkGeo = new THREE.BoxGeometry(0.3, 0.05, 0.05).toNonIndexed();
        forkGeo.translate(0, 0.25, 0); 
        
        const axisParts = [barGeo, forkGeo];
        const axisGeo = mergeBufferGeometries(axisParts);

        const parts = [];
        for(let i=0; i<3; i++) {
            const g = axisGeo.clone();
            g.rotateZ((i * Math.PI) / 1.5);
            parts.push(g);
        }
        
        const finalSnow = mergeBufferGeometries(parts);
        finalSnow.center();
        return finalSnow;
    };

    const geoStar = createStarGeo();
    const geoGift = createGiftGeo();
    const geoSnow = createSnowGeo();
    
    const colGold = new THREE.Color('#FFD700'); 
    const colSilver = new THREE.Color('#C0C0C0'); 

    for(let i=0; i<TOTAL_ITEMS; i++) {
        let isDeco = false;
        let mat;
        let geo;
        
        if (i < PHOTO_COUNT) {
          // --- 照片 ---
          const tex = activePhotoTextures[i % activePhotoTextures.length];
          const scaleBase = 0.6 + Math.random() * 0.3;
          geo = new THREE.PlaneGeometry(1.0 * scaleBase, 1.2 * scaleBase);
          mat = new THREE.ShaderMaterial({
              vertexShader: photoVertexShader, fragmentShader: photoFragmentShader,
              uniforms: { uTexture: { value: tex }, uOpacity: { value: 1.0 } },
              transparent: true, side: THREE.DoubleSide
          });
        } else {
          // --- 装饰 (3D Mesh) ---
          isDeco = true;
          const decoType = i % 3; 
          
          if (decoType === 0) { 
            geo = geoStar.clone(); 
            setGeometryColor(geo, colGold); 
          }
          else if (decoType === 1) { 
            geo = geoGift.clone(); 
          }
          else { 
            geo = geoSnow.clone(); 
            setGeometryColor(geo, colSilver); 
          }

          mat = new THREE.ShaderMaterial({
            vertexShader: decoVertexShader,
            fragmentShader: decoFragmentShader,
            uniforms: {
              uTime: { value: 0 },
              uProgress: { value: 0 },
            },
          });
        }

        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        meshes.push(mesh);

        const r = 40 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const chaosPos = new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
        
        const formedBase = textTargetPositions[i % textTargetPositions.length];
        const formedPos = new THREE.Vector3(
          formedBase.x, 
          formedBase.y, 
          formedBase.z + (Math.random()-0.5) * (isDeco ? 3.0 : 1.0) 
        );

        if (isDeco) {
           const count = mesh.geometry.attributes.position.count;
           const aPosChaos = new Float32Array(count * 3);
           const aPosFormed = new Float32Array(count * 3);
           const aRandomVec = new Float32Array(count * 3);
           const aRandom = new Float32Array(count);
           const rv = [Math.random()-0.5, Math.random()-0.5, Math.random()-0.5];
           const rVal = Math.random();
           for(let v=0; v<count; v++) {
              aPosChaos[v*3]=chaosPos.x; aPosChaos[v*3+1]=chaosPos.y; aPosChaos[v*3+2]=chaosPos.z;
              aPosFormed[v*3]=formedPos.x; aPosFormed[v*3+1]=formedPos.y; aPosFormed[v*3+2]=formedPos.z;
              aRandomVec[v*3]=rv[0]; aRandomVec[v*3+1]=rv[1]; aRandomVec[v*3+2]=rv[2];
              aRandom[v]=rVal;
           }
           mesh.geometry.setAttribute('aPosChaos', new THREE.BufferAttribute(aPosChaos, 3));
           mesh.geometry.setAttribute('aPosFormed', new THREE.BufferAttribute(aPosFormed, 3));
           mesh.geometry.setAttribute('aRandomVec', new THREE.BufferAttribute(aRandomVec, 3));
           mesh.geometry.setAttribute('aRandom', new THREE.BufferAttribute(aRandom, 1));
        }

        objects.push({
            id: i, mesh: mesh, chaosPos: chaosPos, formedPos: formedPos, currentPos: chaosPos.clone(),
            randomRot: new THREE.Euler((Math.random()-0.5)*1.0, (Math.random()-0.5)*1.0, (Math.random()-0.5)*0.5), 
            floatOffset: Math.random() * 100,
            isDeco: isDeco 
        });
    }

    // Input Handling: Unified Touch/Mouse Logic
    const onPointerDown = (e: PointerEvent | TouchEvent) => {
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as PointerEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as PointerEvent).clientY;
        touchStartRef.current = { x: clientX, y: clientY, time: Date.now() };
    };

    const onPointerUp = (e: PointerEvent | TouchEvent) => {
        const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : (e as PointerEvent).clientX;
        const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : (e as PointerEvent).clientY;
        
        const dx = clientX - touchStartRef.current.x;
        const dy = clientY - touchStartRef.current.y;
        const dt = Date.now() - touchStartRef.current.time;

        // Detect Tap (short duration, small movement)
        // 30px for better mobile experience
        if (dt < 300 && Math.hypot(dx, dy) < 30) {
            handleRaycast(clientX, clientY);
        }
    };

    // 核心优化：智能磁吸选择 (Smart Magnetism)
    const handleRaycast = (clientX: number, clientY: number) => {
        const mouse = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(meshes);
        
        let targetId = -1;

        // 1. 尝试直接点击
        if (intersects.length > 0) {
            const obj = objects.find(p => p.mesh === intersects[0].object);
            if (obj && !obj.isDeco) {
                targetId = obj.id;
            }
        }
        
        // 2. 如果没点中，启用磁吸辅助 (Mobile Friendly)
        if (targetId === -1) {
            let minDistance = 0.1; // 归一化距离阈值 (约等于手指触摸范围)
            
            objects.forEach(obj => {
                if (obj.isDeco) return;
                // 将物体坐标投影到屏幕空间
                const screenPos = obj.mesh.position.clone().project(camera);
                const dist = new THREE.Vector2(screenPos.x, screenPos.y).distanceTo(mouse);
                
                if (dist < minDistance) {
                    minDistance = dist;
                    targetId = obj.id;
                }
            });
        }

        // 触发 UI 更新
        if (targetId !== -1) {
            const newId = interactionState.current.activePhotoId === targetId ? -1 : targetId;
            interactionState.current.activePhotoId = newId;
            setUiActiveId(newId); // 更新 React State 以显示按钮
        } else {
            interactionState.current.activePhotoId = -1;
            setUiActiveId(-1);
        }
    };

    // Use Pointer events for universal support
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    // Fallback for mobile Safari
    window.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    const clock = new THREE.Clock();
    let reqId: number;

    const animate = () => {
      reqId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.elapsedTime;

      // Gesture Logic
      const camActive = cameraActiveRef.current;
      if (camActive && gestureRecognizerRef.current && videoRef.current && videoRef.current.readyState === 4) {
          const nowInMs = Date.now();
          if (nowInMs !== lastVideoTimeRef.current) {
              lastVideoTimeRef.current = nowInMs;
              const results = gestureRecognizerRef.current.recognizeForVideo(videoRef.current, nowInMs);
              
              if (results.gestures.length > 0) {
                  const name = results.gestures[0][0].categoryName;
                  setGestureStatus(name);
                  // 只有手势能控制聚合状态
                  if (name === 'Closed_Fist' && !isFormedRef.current) setFormed(true);
                  if (name === 'Open_Palm' && isFormedRef.current) setFormed(false);

                  if (results.landmarks.length > 0) {
                      const hand = results.landmarks[0];
                      const indexTip = hand[8];
                      
                      const handX = (1 - indexTip.x) * 2 - 1;
                      const handY = -(indexTip.y) * 2 + 1;
                      interactionState.current.handPos.set(handX, handY);
                  }
              } else {
                  setGestureStatus('None');
              }
          }
      }

      // Update Stars
      if (starMat.uniforms) {
          starMat.uniforms.uTime.value = time;
          const targetP = isFormedRef.current ? 1 : 0;
          starMat.uniforms.uProgress.value = THREE.MathUtils.lerp(starMat.uniforms.uProgress.value, targetP, 1 - Math.exp(-3.0 * delta));
      }

      // Update Camera
      const targetX = (camActive ? interactionState.current.handPos.x : mouseRef.current.x) * 3.0;
      const targetY = (camActive ? interactionState.current.handPos.y : mouseRef.current.y) * 3.0;
      camera.position.x += (targetX - camera.position.x) * 0.05;
      camera.position.y += (targetY - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);

      const uProgress = starMat.uniforms.uProgress.value;

      objects.forEach(p => {
          const isActive = interactionState.current.activePhotoId === p.id;
          
          if (p.isDeco) {
             (p.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
             (p.mesh.material as THREE.ShaderMaterial).uniforms.uProgress.value = uProgress;
          } else {
             // 2D 照片 (JS Animation)
             p.currentPos.lerpVectors(p.chaosPos, p.formedPos, uProgress); 

              let targetPos = new THREE.Vector3();
              let targetRot = new THREE.Euler();
              let targetScale = 1.0;

              if (isActive) {
                  const camDir = new THREE.Vector3();
                  camera.getWorldDirection(camDir);
                  targetPos.copy(camera.position).add(camDir.multiplyScalar(6)); 
                  targetRot.set(camera.rotation.x, camera.rotation.y, camera.rotation.z);
                  targetScale = 3.0; 
              } else {
                  const floatX = Math.sin(time * 0.5 + p.floatOffset) * 0.2; 
                  const floatY = Math.cos(time * 0.3 + p.floatOffset) * 0.2;
                  targetPos.copy(p.currentPos).add(new THREE.Vector3(floatX, floatY, 0));
                  
                  if (isFormedRef.current) {
                      const speed = 0.05;
                      targetRot.set(Math.sin(time*speed+p.id)*0.1, Math.cos(time*speed*0.5+p.id)*0.1, 0);
                  } else {
                      targetRot.copy(p.randomRot);
                      targetRot.x += Math.sin(time * 0.1) * 0.2;
                  }
              }

              const speed = isActive ? 0.15 : 0.05; 
              p.mesh.position.lerp(targetPos, speed);
              p.mesh.rotation.x += (targetRot.x - p.mesh.rotation.x) * speed;
              p.mesh.rotation.y += (targetRot.y - p.mesh.rotation.y) * speed;
              p.mesh.rotation.z += (targetRot.z - p.mesh.rotation.z) * speed;
              p.mesh.scale.setScalar(THREE.MathUtils.lerp(p.mesh.scale.x, targetScale, speed));
              p.mesh.renderOrder = isActive ? 999 : (p.isDeco ? 1 : 0); 
          }
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
       if(!mountRef.current) return;
       const w = mountRef.current.clientWidth;
       const h = mountRef.current.clientHeight;
       camera.aspect = w/h;
       camera.updateProjectionMatrix();
       renderer.setSize(w, h);
       updateCameraDistance(); 
    };
    const handleMouseMove = (e: MouseEvent) => {
        if (!cameraActive) {
            mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
        }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('touchend', onPointerUp);
      
      cancelAnimationFrame(reqId);
      if(mountRef.current) mountRef.current.innerHTML = '';
      starGeo.dispose();
      starMat.dispose();
      meshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      renderer.dispose();
    };
  }, [cameraActive, userTextures, sceneReady]); 

  return (
    <div className="relative w-full h-screen bg-slate-900 overflow-hidden select-none font-sans">
      <div ref={mountRef} className="w-full h-full block" style={{ background: '#020408' }} />
      <video ref={videoRef} className="absolute top-0 left-0 w-64 h-48 opacity-0 pointer-events-none" autoPlay playsInline muted></video>
      
      {/* Hidden File Input */}
      <input 
        type="file" 
        multiple 
        accept="image/*" 
        ref={fileInputRef}
        className="hidden" 
        onChange={handleUpload}
      />

      {/* Controls Container - Top Left */}
      <div className="fixed top-6 left-6 z-50 flex flex-col gap-3 items-start">
         <div className="flex gap-3">
            <button onClick={enableCam} className={`px-5 py-2 rounded-full border border-white/20 text-xs font-bold tracking-widest uppercase transition-all backdrop-blur-md shadow-lg ${cameraActive ? 'bg-red-500/20 text-red-200 border-red-500/50' : 'bg-black/30 text-white hover:bg-white/10'} ${!modelLoaded ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {!modelLoaded ? 'Loading AI...' : (cameraActive ? 'Stop Camera' : 'Start Camera')}
            </button>

            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="px-5 py-2 rounded-full border border-white/20 text-xs font-bold tracking-widest uppercase transition-all bg-black/30 text-white hover:bg-white/10 backdrop-blur-md shadow-lg"
            >
              Upload
            </button>
         </div>
      </div>

      {/* Carousel UI (Only visible when a photo is active) */}
      {uiActiveId !== -1 && (
         <div className="fixed top-1/2 left-0 w-full -translate-y-1/2 flex justify-between px-4 z-50 pointer-events-none">
            {/* Prev Button */}
            <button 
               onClick={handlePrev}
               className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white flex items-center justify-center text-2xl pointer-events-auto hover:bg-white/20 transition-all active:scale-95"
            >
               ‹
            </button>
            
            {/* Next Button */}
            <button 
               onClick={handleNext}
               className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white flex items-center justify-center text-2xl pointer-events-auto hover:bg-white/20 transition-all active:scale-95"
            >
               ›
            </button>

            {/* Close Button (Top Right) */}
            <button 
               onClick={handleClose}
               className="absolute -top-32 right-4 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs font-bold pointer-events-auto hover:bg-white/20"
            >
               CLOSE
            </button>
         </div>
      )}

      <div className="absolute bottom-10 left-0 w-full pointer-events-none flex flex-col items-center justify-end z-10">
        <div className="mt-4 flex flex-col items-center gap-2 text-yellow-100/60 text-sm tracking-widest font-light uppercase">
          <p className="animate-pulse opacity-80 bg-black/20 px-4 py-1 rounded-full backdrop-blur-sm">
            {cameraActive ? '✊ Fist: Form | 🖐 Palm: Scatter' : 'Tap Photos to View'}
          </p>
        </div>
      </div>
      <div className="absolute top-0 left-0 w-full h-full border-[1px] border-white/5 pointer-events-none m-4 box-border w-[calc(100%-2rem)] h-[calc(100%-2rem)] rounded-3xl z-10 mix-blend-overlay" />
    </div>
  );
}