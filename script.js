import * as THREE from 'https://esm.sh/three@0.160.0';

// Configuration
const SLIDES = [
    {
        id: 'moon-knight',
        image: './images/1.jpeg',
        text: 'MOON KNIGHT',
        font: '900 16vw "Inter", sans-serif'
    },
    {
        id: 'hulk',
        image: './images/3.jpeg',
        text: 'H U L K',
        font: '900 25vw "Inter", sans-serif'
    }
];

// Scene Setup
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
// Camera Setup: Keep it fixed, we will move the container group
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();

// Store our slide meshes
const planeMeshes = [];
const materials = [];

// Helper to create Text Texture
function createTextTexture(text, font) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = window.innerWidth * window.devicePixelRatio;
    const height = window.innerHeight * window.devicePixelRatio;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;
    ctx.fillStyle = '#ffffff';
    // Center alignment roughly
    ctx.fillText(text, width / 2, height / 1.7);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

// Shader Definitions (Must be defined before usage)
const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec2 uVelocity;
    uniform sampler2D uTexture;
    uniform sampler2D uMask;
    uniform vec2 uResolution;
    uniform vec2 uImageResolution;
    varying vec2 vUv;

    // Simplex Noise Function
    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                 -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    void main() {
        // Correct 'Cover' Fit Logic
        vec2 s = uResolution; // Screen
        vec2 i = uImageResolution; // Image
        float rs = s.x / s.y;
        float ri = i.x / i.y;
        vec2 new = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);
        vec2 offset = (rs < ri ? vec2((new.x - s.x) / 2.0, 0.0) : vec2(0.0, (new.y - s.y) / 2.0)) / new;
        vec2 uv = vUv * s / new + offset;

        // 1. Organic Distance Field
        vec2 noisyUV = vUv + vec2(snoise(vUv * 5.0 + uTime), snoise(vUv * 5.0 + uTime + 10.0)) * 0.05;
        float dist = distance(noisyUV, uMouse);
        
        // 2. Velocity-Driven Flow
        float mouseForce = smoothstep(0.15, 0.0, dist);
        vec2 flow = uVelocity * mouseForce * 2.0; 
        
        float noise = snoise(vUv * 10.0 + uTime * 0.5);
        vec2 turbulence = vec2(noise, snoise(vUv * 10.0 + 100.0)) * 0.02 * mouseForce;

        vec2 distortion = flow + turbulence;

        // Apply distortion to UVs
        vec2 distortedUV = uv - distortion; 
        vec2 textDistortedUV = vUv - distortion * 0.5;

        // 3. Texture Lookups
        // We look up the mask to know where the text is
        vec4 maskColor = texture2D(uMask, textDistortedUV);
        float maskVal = maskColor.r;

        // 4. Chromatic Aberration & Image Sample
        // We apply this to the WHOLE image now, not just the text part
        float speed = length(uVelocity);
        float rgbShiftStrength = (0.005 + speed * 0.2) * mouseForce;
        
        float r = texture2D(uTexture, distortedUV + vec2(rgbShiftStrength, 0.0)).r;
        float g = texture2D(uTexture, distortedUV).g;
        float b = texture2D(uTexture, distortedUV - vec2(rgbShiftStrength, 0.0)).b;
        vec3 finalImage = vec3(r, g, b);

        // 5. Composition
        // Background: Visible but darker (0.7 intensity)
        // Text: Full Brightness (1.2 intensity)
        // Interaction: The ripple affects both because 'finalImage' uses 'distortedUV'
        
        vec3 bgLayer = finalImage * 0.7; 
        vec3 textLayer = finalImage * 1.2;
        
        // Smooth mix based on the text shape
        vec3 finalPixel = mix(bgLayer, textLayer, smoothstep(0.1, 0.9, maskVal));

        // Output with full opacity
        gl_FragColor = vec4(finalPixel, 1.0);
    }
`;


// Re-use geometry (will resize later)
let geometry = new THREE.PlaneGeometry(2, 2);

// Create Slides
SLIDES.forEach((slide, index) => {
    // 1. Text Texture
    const textTexture = createTextTexture(slide.text, slide.font);

    // 2. Image Texture
    const imgTexture = loader.load(slide.image, (tex) => {
        if (materials[index]) {
            materials[index].uniforms.uImageResolution.value.set(
                tex.image.naturalWidth,
                tex.image.naturalHeight
            );
        }
    });
    imgTexture.minFilter = THREE.LinearFilter;
    imgTexture.magFilter = THREE.LinearFilter;

    // 3. Material (Clone uniforms)
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uMouse: { value: new THREE.Vector2(0.5, 0.5) },
            uVelocity: { value: new THREE.Vector2(0, 0) },
            uTexture: { value: imgTexture },
            uMask: { value: textTexture },
            uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            // Default resolution until loaded
            uImageResolution: { value: new THREE.Vector2(1920, 1080) }
        },
        transparent: true
    });

    materials.push(material);

    const plane = new THREE.Mesh(geometry, material);

    // Position vertically
    // View Height in 3D units at z=0 is calculated below
    // We strictly position them: 0, -visibleHeight, -2*visibleHeight...
    // We'll update positions in 'resize'

    scene.add(plane);
    planeMeshes.push(plane);
});


// Resize Handler
let visibleHeight = 2; // Default
let visibleWidth = 2;
function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // Calculate view size at z=0
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    visibleHeight = 2 * Math.tan(vFOV / 2) * camera.position.z;
    visibleWidth = visibleHeight * camera.aspect;

    // Update Geometry size
    // Make slightly wider to ensure smooth entry/exit
    geometry.dispose();
    geometry = new THREE.PlaneGeometry(visibleWidth * 1.05, visibleHeight * 1.05);

    // Update each mesh
    planeMeshes.forEach((mesh, index) => {
        mesh.geometry = geometry;
        // Stack them Horizontally: Slide 0 at 0, Slide 1 at +visibleWidth
        mesh.position.x = index * visibleWidth;
        mesh.position.y = 0; // Keep centered vertically

        // Update uniforms
        mesh.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
        const slide = SLIDES[index];
        mesh.material.uniforms.uMask.value = createTextTexture(slide.text, slide.font);
    });
}
window.addEventListener('resize', resize);
resize();


// Mouse State
const mouse = new THREE.Vector2(0.5, 0.5);
const targetMouse = new THREE.Vector2(0.5, 0.5);
const velocity = new THREE.Vector2(0, 0);

window.addEventListener('mousemove', (e) => {
    targetMouse.x = e.clientX / window.innerWidth;
    targetMouse.y = 1.0 - (e.clientY / window.innerHeight);
});

// Scroll State
let currentScroll = 0;
let targetScroll = 0;

// Animation Loop
let time = 0;
function animate() {
    time += 0.01;

    // 1. Mouse Velocity Logic
    const lag = 0.08;
    const newX = mouse.x + (targetMouse.x - mouse.x) * lag;
    const newY = mouse.y + (targetMouse.y - mouse.y) * lag;
    velocity.x = (newX - mouse.x) * 10.0;
    velocity.y = (newY - mouse.y) * 10.0;
    mouse.x = newX;
    mouse.y = newY;

    // 2. Scroll Logic
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    const scrollPercent = window.scrollY / (maxScroll || 1); // 0 to 1

    // Total distance to move = (NumSlides - 1) * visibleWidth
    const totalTravel = (SLIDES.length - 1) * visibleWidth;

    // Move Camera RIGHT (positive X) to see next slides
    targetScroll = scrollPercent * totalTravel;

    // Smooth Camera
    currentScroll += (targetScroll - currentScroll) * 0.1;
    camera.position.x = currentScroll;
    // Reset Y to 0 just in case
    camera.position.y = 0;

    // 3. Update Uniforms for ALL slides
    materials.forEach((mat, index) => {
        mat.uniforms.uTime.value = time;

        // Adjust Mouse for Horizontal Scroll?
        // Like before, uMouse is 0..1 Screen Space.
        // It represents "Cursor position on the viewport".
        // The shader logic distance(vUv, uMouse) works on the specific plane's texture space (0..1).
        // If a plane is strictly filling the viewport, this works 1:1.
        // During transition, the plane is moving relative to viewport.
        // So strict mapping might drift, but for a liquid effect it often looks fine.
        // For perfect accuracy, we'd offset uMouse by the plane's relative screen position.
        // But let's leave as is for now—it creates a "lens" effect where the distortion stays center-screen.

        mat.uniforms.uMouse.value.copy(mouse);
        mat.uniforms.uVelocity.value.copy(velocity);
    });

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

animate();
