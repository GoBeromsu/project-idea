(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.IdeaSceneManager = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const PALETTE = {
        canvas: 0x05070f,
        portalDark: 0x02040a,
        cyan: 0x38bdf8,
        blue: 0x60a5fa,
        violet: 0xa78bfa,
        indigo: 0x818cf8,
        teal: 0x2dd4bf,
        amber: 0xf59e0b,
        rose: 0xf43f5e,
        slate: 0x475569,
        border: 0x1e293b,
        white: 0xf8fafc
    };
    function resolveNodeColor(nodeType, status) {
        const s = (status || "").toUpperCase();
        if (s === "UNRESOLVED") return PALETTE.rose;
        if (s === "PROPOSED" || s === "PENDING" || s === "NEEDS_REVIEW") return PALETTE.amber;
        if (s === "REJECTED" || s === "BLOCKED") return PALETTE.slate;
        const t = (nodeType || "").toUpperCase();
        if (t === "TERM") return PALETTE.cyan;
        if (t === "ENTITY") return PALETTE.violet;
        if (t === "CLAIM") return PALETTE.indigo;
        return PALETTE.blue;
    }
    function createGlowTexture(hexColor) {
        if (typeof document === 'undefined' || !document.createElement) return null;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        const colorStr = '#' + hexColor.toString(16).padStart(6, '0');
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.18, colorStr);
        gradient.addColorStop(0.55, colorStr + '44');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }
    let sharedParticleTex = null;
    function getParticleTexture() {
        if (sharedParticleTex) return sharedParticleTex;
        if (typeof document === 'undefined' || !document.createElement) return null;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
        grad.addColorStop(0.7, 'rgba(255,255,255,0.2)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        sharedParticleTex = new THREE.CanvasTexture(canvas);
        return sharedParticleTex;
    }
    class IdeaSceneManager {
        constructor(containerEl, callbacks = {}) {
            if (!containerEl) throw new Error("IdeaSceneManager requires a valid container element");
            this.container = containerEl;
            this.callbacks = Object.assign({
                onNodeClick: null,
                onBackgroundClick: null,
                onHover: null
            }, callbacks);
            this.isPaused = false;
            this.executionStage = "Idle";
            this.tracedNodeId = null;
            this.activeTracePath = new Set();
            this.activeTraceEdges = new Set();
            this.highlightedNodeIds = new Set();
            this.activeLayerFilter = "all";
            this.nodes = new Map();
            this.edges = [];
            this.inflowThreads = [];
            this.synthesisThreads = [];
            this.edgePulses = [];
            this.clock = new (typeof THREE !== "undefined" ? THREE.Clock : class { getDelta() { return 0.016; } getElapsedTime() { return 0; } })();
            this.animatingAbsorptions = [];
            this.pointerDownPos = { x: 0, y: 0 };
            this.pointerDownTime = 0;
            this.isPointerDown = false;
            this.desiredCameraPos = null;
            this.desiredControlTarget = null;
            if (typeof THREE !== "undefined") {
                this.initThree();
                this.buildEnvironment();
                this.buildBlackHole();
                this.buildWhiteHole();
                this.buildArenaPlanes();
                this.buildGlobalStream();
                this.initLabelsOverlay();
                this.bindEvents();
                this.startRenderLoop();
            }
        }
        initThree() {
            const width = this.container.clientWidth || window.innerWidth || 1366;
            const height = this.container.clientHeight || window.innerHeight || 768;
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(PALETTE.canvas);
            this.scene.fog = new THREE.FogExp2(PALETTE.canvas, 0.0065);
            this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 1000);
            this.defaultCameraPos = new THREE.Vector3(0, 7, 38);
            this.defaultTargetPos = new THREE.Vector3(0, 0, 0);
            this.camera.position.copy(this.defaultCameraPos);
            this.camera.lookAt(this.defaultTargetPos);
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
            this.renderer.setSize(width, height);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;
            this.container.appendChild(this.renderer.domElement);
            if (typeof THREE.OrbitControls !== "undefined") {
                this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.06;
                this.controls.target.copy(this.defaultTargetPos);
                this.controls.maxDistance = 85;
                this.controls.minDistance = 10;
                this.controls.maxPolarAngle = Math.PI / 2 + 0.25;
            }
            this.raycaster = new THREE.Raycaster();
            this.mouseNDC = new THREE.Vector2();
            this.scene.add(new THREE.AmbientLight(0xffffff, 0.82));
            const keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
            keyLight.position.set(15, 30, 25);
            this.scene.add(keyLight);
            const fillLight = new THREE.DirectionalLight(PALETTE.blue, 0.35);
            fillLight.position.set(-25, 10, -10);
            this.scene.add(fillLight);
            const softGreenLight = new THREE.DirectionalLight(PALETTE.teal, 0.3);
            softGreenLight.position.set(25, -10, 10);
            this.scene.add(softGreenLight);
            this.graphGroup = new THREE.Group();
            this.scene.add(this.graphGroup);
        }
        buildEnvironment() {
            const pTex = getParticleTexture();
            const gridHelper = new THREE.GridHelper(68, 34, 0x1e293b, 0x0f172a);
            gridHelper.position.y = -11.0;
            gridHelper.material.opacity = 0.14;
            gridHelper.material.transparent = true;
            this.scene.add(gridHelper);
            const dustCount = 260;
            const dustGeo = new THREE.BufferGeometry();
            const dustPos = new Float32Array(dustCount * 3);
            for (let i = 0; i < dustCount; i++) {
                dustPos[i * 3 + 0] = (Math.random() - 0.5) * 64;
                dustPos[i * 3 + 1] = (Math.random() - 0.5) * 26;
                dustPos[i * 3 + 2] = (Math.random() - 0.5) * 32;
            }
            dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
            const dustMat = new THREE.PointsMaterial({
                color: 0x60a5fa,
                 map: pTex,
                size: 0.34,
                transparent: true,
                opacity: 0.48,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            this.ambientDust = new THREE.Points(dustGeo, dustMat);
            this.scene.add(this.ambientDust);
            const starCount = 320;
            const starGeo = new THREE.BufferGeometry();
            const starPos = new Float32Array(starCount * 3);
            for (let i = 0; i < starCount; i++) {
                starPos[i * 3 + 0] = (Math.random() - 0.5) * 90;
                starPos[i * 3 + 1] = (Math.random() - 0.5) * 45;
                starPos[i * 3 + 2] = (Math.random() - 0.5) * 60 - 20;
            }
            starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
            const starMat = new THREE.PointsMaterial({
                color: 0xe2e8f0,
                map: pTex,
                size: 0.24,
                transparent: true,
                opacity: 0.38,
                depthWrite: false
            });
            this.starfield = new THREE.Points(starGeo, starMat);
            this.scene.add(this.starfield);
        }
        buildBlackHole() {
            const pTex = getParticleTexture();
            this.blackHoleGroup = new THREE.Group();
            this.blackHoleGroup.position.set(-22, 0, 0);
            const coreGeo = new THREE.SphereGeometry(2.0, 32, 32);
            const coreMat = new THREE.MeshStandardMaterial({ color: 0x02040a, roughness: 0.9, metalness: 0.1 });
            this.blackHoleCore = new THREE.Mesh(coreGeo, coreMat);
            this.blackHoleGroup.add(this.blackHoleCore);
            const photonGeo = new THREE.TorusGeometry(2.15, 0.08, 24, 96);
            const photonMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
            this.bhPhotonRing = new THREE.Mesh(photonGeo, photonMat);
            this.bhPhotonRing.rotation.y = Math.PI * 0.42;
            this.blackHoleGroup.add(this.bhPhotonRing);
            const disk1Geo = new THREE.RingGeometry(2.4, 4.8, 64);
            const disk1Mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.36, depthWrite: false, blending: THREE.AdditiveBlending });
            this.bhDisk1 = new THREE.Mesh(disk1Geo, disk1Mat);
            this.bhDisk1.rotation.x = Math.PI * 0.38;
            this.bhDisk1.rotation.y = 0.25;
            this.blackHoleGroup.add(this.bhDisk1);
            const disk2Geo = new THREE.RingGeometry(2.8, 5.4, 64);
            const disk2Mat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
            this.bhDisk2 = new THREE.Mesh(disk2Geo, disk2Mat);
            this.bhDisk2.rotation.x = -Math.PI * 0.32;
            this.bhDisk2.rotation.z = 0.4;
            this.blackHoleGroup.add(this.bhDisk2);
            const hitGeo = new THREE.SphereGeometry(3.4, 16, 16);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
            this.blackHoleHitMesh = new THREE.Mesh(hitGeo, hitMat);
            this.blackHoleHitMesh.userData = {
                id: "portal_black_hole",
                name: "Black Hole · Source Input",
                node_type: "PORTAL",
                role: "source_portal",
                description: "Ingests external URLs and technical documents into candidate knowledge layers."
            };
            this.blackHoleGroup.add(this.blackHoleHitMesh);
            const glowTex = createGlowTexture(0x38bdf8);
            if (glowTex) {
                const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x38bdf8, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false });
                const glowSprite = new THREE.Sprite(glowMat);
                glowSprite.scale.set(11.5, 11.5, 1);
                this.blackHoleGroup.add(glowSprite);
            }
            const pCount = 560;
            this.bhVortexData = [];
            const pPositions = new Float32Array(pCount * 3);
            for (let i = 0; i < pCount; i++) {
                const progress = Math.random();
                const angle = Math.random() * Math.PI * 2;
                const rSpread = 0.35 + Math.random() * 5.2;
                const speed = 0.012 + Math.random() * 0.016;
                const spin = 0.035 + Math.random() * 0.045;
                this.bhVortexData.push({ progress, angle, rSpread, speed, spin });
                const x = -11.0 + progress * 16.0;
                const funnelEnvelope = Math.max(0.18, 1.0 - progress * 0.82);
                const r = rSpread * funnelEnvelope;
                pPositions[i * 3 + 0] = x;
                pPositions[i * 3 + 1] = Math.cos(angle) * r;
                pPositions[i * 3 + 2] = Math.sin(angle) * r;
            }
            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: 0x38bdf8,
                map: pTex,
                size: 0.42,
                transparent: true,
                opacity: 0.88,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            this.bhVortexParticles = new THREE.Points(pGeo, pMat);
            this.blackHoleGroup.add(this.bhVortexParticles);
            this.scene.add(this.blackHoleGroup);
        }
        buildWhiteHole() {
            const pTex = getParticleTexture();
            this.whiteHoleGroup = new THREE.Group();
            this.whiteHoleGroup.position.set(22, 0, 0);
            const coreGeo = new THREE.SphereGeometry(1.75, 32, 32);
            const coreMat = new THREE.MeshStandardMaterial({ color: 0xecfeff, emissive: 0x2dd4bf, emissiveIntensity: 0.85, roughness: 0.15 });
            this.whiteHoleCore = new THREE.Mesh(coreGeo, coreMat);
            this.whiteHoleGroup.add(this.whiteHoleCore);
            const ring1Geo = new THREE.TorusGeometry(2.7, 0.06, 20, 96);
            const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending });
            this.whRing1 = new THREE.Mesh(ring1Geo, ring1Mat);
            this.whRing1.rotation.x = Math.PI * 0.35;
            this.whRing1.rotation.y = -0.3;
            this.whiteHoleGroup.add(this.whRing1);
            const ring2Geo = new THREE.TorusGeometry(3.5, 0.045, 20, 96);
            const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending });
            this.whRing2 = new THREE.Mesh(ring2Geo, ring2Mat);
            this.whRing2.rotation.x = -Math.PI * 0.28;
            this.whRing2.rotation.z = 0.35;
            this.whiteHoleGroup.add(this.whRing2);
            const hitGeo = new THREE.SphereGeometry(3.4, 16, 16);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
            this.whiteHoleHitMesh = new THREE.Mesh(hitGeo, hitMat);
            this.whiteHoleHitMesh.userData = {
                id: "portal_white_hole",
                name: "White Hole · Approved Wiki",
                node_type: "PORTAL",
                role: "wiki_portal",
                description: "Synthesizes and radiates verified session knowledge approved into the canonical Wiki."
            };
            this.whiteHoleGroup.add(this.whiteHoleHitMesh);
            const glowTex = createGlowTexture(0x2dd4bf);
            if (glowTex) {
                const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x2dd4bf, transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false });
                const glowSprite = new THREE.Sprite(glowMat);
                glowSprite.scale.set(12.0, 12.0, 1);
                this.whiteHoleGroup.add(glowSprite);
            }
            const pCount = 560;
            this.whFountainData = [];
            const pPositions = new Float32Array(pCount * 3);
            for (let i = 0; i < pCount; i++) {
                const progress = Math.random();
                const angle = Math.random() * Math.PI * 2;
                const rSpread = 0.35 + Math.random() * 5.4;
                const speed = 0.012 + Math.random() * 0.016;
                const spin = 0.03 + Math.random() * 0.04;
                this.whFountainData.push({ progress, angle, rSpread, speed, spin });
                const x = -5.0 + progress * 16.0;
                const coneEnvelope = 0.16 + progress * 0.84;
                const r = rSpread * coneEnvelope;
                pPositions[i * 3 + 0] = x;
                pPositions[i * 3 + 1] = Math.cos(angle) * r;
                pPositions[i * 3 + 2] = Math.sin(angle) * r;
            }
            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: 0x2dd4bf,
                map: pTex,
                size: 0.42,
                transparent: true,
                opacity: 0.88,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            this.whFountainParticles = new THREE.Points(pGeo, pMat);
            this.whiteHoleGroup.add(this.whFountainParticles);
            this.scene.add(this.whiteHoleGroup);
        }
        buildArenaPlanes() {
            this.ringGroups = [];
            this.rings = [
                { id: "ring_terms", x: -8.5, radius: 4.8, rotY: -0.62, rotX: 0.11, speed: 0.0028, type: "TERM", key: "term", color: 0x38bdf8, colorHex: "#38bdf8", label: "LAYER 01 · TERMS" },
                { id: "ring_concepts", x: 0.0, radius: 5.2, rotY: -0.62, rotX: 0.11, speed: -0.0022, type: "CONCEPT", key: "concept", color: 0x60a5fa, colorHex: "#60a5fa", label: "LAYER 02 · CONCEPTS & ENTITIES" },
                { id: "ring_claims", x: 8.5, radius: 4.8, rotY: -0.62, rotX: 0.11, speed: 0.0025, type: "CLAIM", key: "claim", color: 0x2dd4bf, colorHex: "#2dd4bf", label: "LAYER 03 · GROUNDED CLAIMS" }
            ];
            this.rings.forEach(ringCfg => {
                const group = new THREE.Group();
                group.position.set(ringCfg.x, 0, 0);
                group.rotation.y = ringCfg.rotY;
                group.rotation.x = ringCfg.rotX;
                const planeW = 13.0;
                const planeH = 13.8;
                const planeGeo = new THREE.PlaneGeometry(planeW, planeH, 6, 6);
                const planeMat = new THREE.MeshBasicMaterial({
                    color: ringCfg.color,
                    transparent: true,
                    opacity: 0.075,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                const planeMesh = new THREE.Mesh(planeGeo, planeMat);
                group.add(planeMesh);
                const edgesGeo = new THREE.EdgesGeometry(planeGeo);
                const edgesMat = new THREE.LineBasicMaterial({
                    color: ringCfg.color,
                    transparent: true,
                    opacity: 0.22,
                    blending: THREE.AdditiveBlending
                });
                const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
                group.add(edgesMesh);
                const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(planeW, planeH));
                const borderMat = new THREE.LineBasicMaterial({
                    color: ringCfg.color,
                    transparent: true,
                    opacity: 0.68,
                    linewidth: 2,
                    blending: THREE.AdditiveBlending
                });
                const borderMesh = new THREE.LineSegments(borderGeo, borderMat);
                group.add(borderMesh);
                const trackGeo = new THREE.RingGeometry(ringCfg.radius - 0.04, ringCfg.radius + 0.04, 64);
                const trackMat = new THREE.MeshBasicMaterial({
                    color: ringCfg.color,
                    transparent: true,
                    opacity: 0.34,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                const trackMesh = new THREE.Mesh(trackGeo, trackMat);
                group.add(trackMesh);
                this.scene.add(group);
                this.ringGroups.push({
                    cfg: ringCfg,
                    group: group,
                    planeMat: planeMat,
                    edgesMat: edgesMat,
                    borderMat: borderMat,
                    trackMat: trackMat,
                    headerAnchor: new THREE.Vector3(0, planeH * 0.5 + 0.9, 0),
                    currentAngle: 0
                });
            });
        }
        buildGlobalStream() {
            const pTex = getParticleTexture();
            const pCount = 420;
            this.globalStreamData = [];
            const pPositions = new Float32Array(pCount * 3);
            for (let i = 0; i < pCount; i++) {
                const x = -22 + Math.random() * 44;
                const y = (Math.random() - 0.5) * 7.5;
                const z = (Math.random() - 0.5) * 7.5;
                this.globalStreamData.push({ x, y, z, speed: 0.12 + Math.random() * 0.14 });
                pPositions[i * 3 + 0] = x;
                pPositions[i * 3 + 1] = y;
                pPositions[i * 3 + 2] = z;
            }
            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: 0x7dd3fc,
                map: pTex,
                size: 0.34,
                transparent: true,
                opacity: 0.65,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            this.globalStreamParticles = new THREE.Points(pGeo, pMat);
            this.scene.add(this.globalStreamParticles);
        }
        initLabelsOverlay() {
            this.labelsOverlay = document.createElement("div");
            this.labelsOverlay.className = "idea-scene-labels-overlay";
            Object.assign(this.labelsOverlay.style, {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                overflow: "hidden",
                zIndex: "5"
            });
            this.container.style.position = "relative";
            this.container.appendChild(this.labelsOverlay);
            this.labelElements = new Map();
            this.layerHeaderElements = [];
        }
        updateLabels() {
            if (!this.labelsOverlay || !this.camera) return;
            const maxVisible = 20;
            const tempVec = new THREE.Vector3();
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;
            if (this.ringGroups && this.ringGroups.length > 0) {
                if (!this.layerHeaderElements || this.layerHeaderElements.length !== this.ringGroups.length) {
                    this.layerHeaderElements = this.ringGroups.map((ringInfo) => {
                        const hdr = document.createElement("div");
                        hdr.className = "idea-arena-layer-header";
                        hdr.textContent = ringInfo.cfg.label;
                        Object.assign(hdr.style, {
                            position: "absolute",
                            fontSize: "10px",
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontWeight: "700",
                            letterSpacing: "0.08em",
                            padding: "3px 9px",
                            borderRadius: "9999px",
                            background: "rgba(5, 7, 15, 0.86)",
                            backdropFilter: "blur(8px)",
                            border: "1px solid " + ringInfo.cfg.colorHex,
                            color: ringInfo.cfg.colorHex,
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.65)",
                            transform: "translate(-50%, -50%)",
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                            transition: "opacity 0.2s ease"
                        });
                        this.labelsOverlay.appendChild(hdr);
                        return hdr;
                    });
                }
                this.ringGroups.forEach((ringInfo, idx) => {
                    const hdr = this.layerHeaderElements[idx];
                    if (!hdr) return;
                    const worldAnchor = ringInfo.headerAnchor.clone().applyEuler(ringInfo.group.rotation).add(ringInfo.group.position);
                    worldAnchor.project(this.camera);
                    if (worldAnchor.z > 1) {
                        hdr.style.display = "none";
                        return;
                    }
                    const sx = (worldAnchor.x * 0.5 + 0.5) * width;
                    const sy = (-worldAnchor.y * 0.5 + 0.5) * height;
                    hdr.style.left = `${sx}px`;
                    hdr.style.top = `${sy}px`;
                    hdr.style.display = "block";
                    const isLayerActive = this.activeLayerFilter === "all" || this.activeLayerFilter === "proposed" || this.activeLayerFilter === ringInfo.cfg.key;
                    hdr.style.opacity = isLayerActive ? "0.95" : "0.24";
                });
            }
            const prioritized = [];
            this.nodes.forEach((nodeRecord, id) => {
                const isPrioritized = this.tracedNodeId === id || this.activeTracePath.has(id) || this.highlightedNodeIds.has(id) || nodeRecord.isProposed;
                prioritized.push({ id, record: nodeRecord, prio: isPrioritized ? 1 : 0 });
            });
            prioritized.sort((a, b) => b.prio - a.prio);
            const toShow = new Set();
            for (let i = 0; i < prioritized.length; i++) {
                if (toShow.size < maxVisible && prioritized[i].record.mesh.visible) {
                    prioritized[i].record.mesh.getWorldPosition(tempVec);
                    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
                    const toNode = tempVec.clone().sub(this.camera.position);
                    if (toNode.dot(camDir) > 0) {
                        tempVec.project(this.camera);
                        if (!(tempVec.x < -0.92 || tempVec.x > 0.92 || tempVec.y < -0.92 || tempVec.y > 0.92 || tempVec.z > 1)) {
                            toShow.add(prioritized[i].id);
                        }
                    }
                }
            }
            this.nodes.forEach((nodeRecord, id) => {
                let el = this.labelElements.get(id);
                if (!el) {
                    el = document.createElement("div");
                    el.className = "idea-3d-node-label";
                    let prefix = "● ";
                    const nt = (nodeRecord.data.node_type || "").toUpperCase();
                    if (nt === "TERM") prefix = "◆ ";
                    else if (nt === "ENTITY") prefix = "■ ";
                    else if (nt === "CLAIM") prefix = "◎ ";
                    if (nodeRecord.isProposed) prefix = "◌ ";
                    const rawName = nodeRecord.data.name || nodeRecord.data.statement || id;
                    el.textContent = prefix + (rawName.length > 22 ? rawName.slice(0, 21) + "…" : rawName);
                    const cleanHex = String((nodeRecord.baseColor || 0x38bdf8).toString(16).padStart(6, '0')).replace(/^#/, '');
                    Object.assign(el.style, {
                        position: "absolute",
                        fontSize: "11px",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        fontWeight: "600",
                        padding: "2px 7px",
                        borderRadius: "8px",
                        background: "rgba(8, 13, 26, 0.86)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid #" + cleanHex,
                        color: "#F8FAFC",
                        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.55)",
                        transform: "translate(-50%, -130%)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        transition: "opacity 0.15s ease",
                        display: "none"
                    });
                    this.labelsOverlay.appendChild(el);
                    this.labelElements.set(id, el);
                }
                if (!toShow.has(id)) {
                    el.style.display = "none";
                    return;
                }
                nodeRecord.mesh.getWorldPosition(tempVec);
                tempVec.project(this.camera);
                const screenX = (tempVec.x * 0.5 + 0.5) * width;
                const screenY = (-tempVec.y * 0.5 + 0.5) * height;
                el.style.left = `${screenX}px`;
                el.style.top = `${screenY}px`;
                el.style.display = "block";
                if (this.activeLayerFilter !== "all" && !nodeRecord.layerMatch) {
                    el.style.opacity = "0.15";
                } else if (this.tracedNodeId && !this.activeTracePath.has(id)) {
                    el.style.opacity = "0.2";
                } else {
                    el.style.opacity = "0.95";
                }
                el.style.borderColor = "rgba(" + [(nodeRecord.baseColor>>16)&255, (nodeRecord.baseColor>>8)&255, nodeRecord.baseColor&255].join(',') + ", 0.45)";
            });
        }
        bindEvents() {
            const dom = this.renderer.domElement;
            dom.addEventListener("pointerdown", (e) => {
                this.isPointerDown = true;
                this.pointerDownPos = { x: e.clientX, y: e.clientY };
                this.pointerDownTime = performance.now();
                this.desiredCameraPos = null;
                this.desiredControlTarget = null;
            });
            dom.addEventListener("wheel", () => {
                this.desiredCameraPos = null;
                this.desiredControlTarget = null;
            });
            dom.addEventListener("pointerup", (e) => {
                if (!this.isPointerDown) return;
                this.isPointerDown = false;
                const dx = e.clientX - this.pointerDownPos.x;
                const dy = e.clientY - this.pointerDownPos.y;
                const dist = Math.hypot(dx, dy);
                const elapsed = performance.now() - this.pointerDownTime;
                if (dist < 6 && elapsed < 500) {
                    this.handlePointerClick(e);
                }
            });
            if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
                window.addEventListener("resize", () => this.handleResize());
            }
        }
        handlePointerClick(e) {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouseNDC, this.camera);
            const clickableObjects = [];
            if (this.blackHoleHitMesh) clickableObjects.push(this.blackHoleHitMesh);
            if (this.whiteHoleHitMesh) clickableObjects.push(this.whiteHoleHitMesh);
            this.nodes.forEach(nodeRecord => {
                if (nodeRecord.hitMesh && nodeRecord.mesh.visible) {
                    clickableObjects.push(nodeRecord.hitMesh);
                }
            });
            const intersects = this.raycaster.intersectObjects(clickableObjects, false);
            if (intersects.length > 0) {
                const hit = intersects[0].object;
                if (hit.userData) {
                    if (typeof this.callbacks.onNodeClick === "function") {
                        this.callbacks.onNodeClick(hit.userData);
                    }
                    return;
                }
            }
            if (typeof this.callbacks.onBackgroundClick === "function") {
                this.callbacks.onBackgroundClick();
            }
        }
        handleResize() {
            if (!this.renderer || !this.camera) return;
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        }
        createNodeGeometry(nodeType) {
            const t = (nodeType || "").toUpperCase();
            if (t === "TERM") return new THREE.OctahedronGeometry(0.54, 0);
            if (t === "ENTITY") return new THREE.BoxGeometry(0.62, 0.62, 0.62);
            if (t === "CLAIM") return new THREE.SphereGeometry(0.48, 24, 24);
            return new THREE.SphereGeometry(0.52, 24, 24);
        }
        resolveRingIndex(nodeType) {
            const t = (nodeType || "").toUpperCase();
            if (t === "TERM" || t === "JARGON") return 0;
            if (t === "CLAIM" || t === "WIKI") return 2;
            return 1;
        }
        setLayerFilter(filterType) {
            const normalized = filterType === "jargon" ? "term" : filterType === "concepts" || filterType === "entities" ? "concept" : filterType === "wiki" ? "claim" : (filterType || "all");
            this.activeLayerFilter = normalized;
            if (this.ringGroups) {
                this.ringGroups.forEach(ringInfo => {
                    const active = normalized === "all" || normalized === "proposed" || normalized === ringInfo.cfg.key;
                    if (ringInfo.planeMat) ringInfo.planeMat.opacity = active ? 0.085 : 0.018;
                    if (ringInfo.edgesMat) ringInfo.edgesMat.opacity = active ? 0.24 : 0.05;
                    if (ringInfo.borderMat) ringInfo.borderMat.opacity = active ? 0.72 : 0.16;
                    if (ringInfo.trackMat) ringInfo.trackMat.opacity = active ? 0.36 : 0.08;
                });
            }
            if (normalized === 'all') {
                this.nodes.forEach((n) => {
                    n.layerMatch = true;
                    n.mesh.material.opacity = 0.95;
                    n.mesh.material.emissiveIntensity = n.isProposed ? 0.45 : 0.25;
                    n.mesh.scale.set(1.0, 1.0, 1.0);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.65;
                    if (n.wireframe) n.wireframe.material.opacity = 0.65;
                });
                this.edges.forEach(e => {
                    e.line.material.opacity = e.isProposed ? 0.75 : 0.45;
                });
                return;
            }
            this.nodes.forEach((n) => {
                let match = false;
                const t = (n.data.node_type || "").toUpperCase();
                if (normalized === 'term' && t === "TERM") match = true;
                if (normalized === 'concept' && (t === "CONCEPT" || t === "ENTITY")) match = true;
                if (normalized === 'claim' && (t === "CLAIM" || t === "WIKI")) match = true;
                if (normalized === 'proposed' && n.isProposed) match = true;
                n.layerMatch = match;
                if (match) {
                    n.mesh.material.opacity = 0.95;
                    n.mesh.material.emissiveIntensity = n.isProposed ? 0.5 : 0.35;
                    n.mesh.scale.set(1.12, 1.12, 1.12);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.75;
                    if (n.wireframe) n.wireframe.material.opacity = 0.75;
                } else {
                    n.mesh.material.opacity = 0.15;
                    n.mesh.material.emissiveIntensity = 0.05;
                    n.mesh.scale.set(0.8, 0.8, 0.8);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.1;
                    if (n.wireframe) n.wireframe.material.opacity = 0.1;
                }
            });
            this.edges.forEach(e => {
                const src = this.nodes.get(e.sourceId);
                const tgt = this.nodes.get(e.targetId);
                if ((src && src.layerMatch) || (tgt && tgt.layerMatch)) {
                    e.line.material.opacity = e.isProposed ? 0.75 : 0.45;
                } else {
                    e.line.material.opacity = 0.05;
                }
            });
        }
        syncGraph(stateData = {}, activeChangeSet = null) {
            if (!this.graphGroup) return;
            this.nodes.forEach(n => {
                if (n.mesh.parent) n.mesh.parent.remove(n.mesh);
                if (n.hitMesh.parent) n.hitMesh.parent.remove(n.hitMesh);
            });
            this.nodes.clear();
            this.edges.forEach(e => {
                if (e.line.parent) e.line.parent.remove(e.line);
            });
            this.edges = [];
            this.inflowThreads.forEach(t => {
                if (t.line.parent) t.line.parent.remove(t.line);
            });
            this.inflowThreads = [];
            this.synthesisThreads.forEach(t => {
                if (t.line.parent) t.line.parent.remove(t.line);
            });
            this.synthesisThreads = [];
            if (this.edgeFlowSystem) {
                if (this.edgeFlowSystem.parent) this.edgeFlowSystem.parent.remove(this.edgeFlowSystem);
                this.edgeFlowSystem = null;
            }
            this.edgePulses = [];
            if (this.labelsOverlay) {
                this.labelsOverlay.innerHTML = "";
            }
            this.labelElements.clear();
            this.layerHeaderElements = [];
            const rawConcepts = stateData.concepts || [];
            const rawRelations = stateData.relations || [];
            const rawClaims = stateData.claims || [];
            const allItems = [];
            rawConcepts.forEach(c => allItems.push({ ...c, node_type: c.node_type || "CONCEPT", category: "concept" }));
            rawClaims.forEach(cl => allItems.push({
                id: cl.id,
                name: cl.statement,
                statement: cl.statement,
                concept_id: cl.concept_id,
                status: cl.status || "VERIFIED",
                node_type: "CLAIM",
                category: "claim",
                evidence: cl.evidence,
                is_seed: cl.is_seed
            }));
            const isChangeSetPending = activeChangeSet && (activeChangeSet.status === "PENDING" || !activeChangeSet.status);
            const proposedItemIds = new Set();
            if (isChangeSetPending) {
                (activeChangeSet.proposed_concepts || []).forEach(c => {
                    const item = { ...c, node_type: c.node_type || "CONCEPT", status: "PROPOSED", category: "concept", isProposed: true };
                    allItems.push(item);
                    proposedItemIds.add(item.id);
                });
                (activeChangeSet.proposed_claims || []).forEach(cl => {
                    const item = {
                        id: cl.id,
                        name: cl.statement,
                        statement: cl.statement,
                        concept_id: cl.concept_id,
                        status: "PROPOSED",
                        node_type: "CLAIM",
                        category: "claim",
                        evidence: cl.evidence,
                        isProposed: true
                    };
                    allItems.push(item);
                    proposedItemIds.add(item.id);
                });
                (activeChangeSet.unresolved_conflicts || []).forEach(cl => {
                    const item = {
                        id: cl.id,
                        name: cl.statement,
                        statement: cl.statement,
                        concept_id: cl.concept_id,
                        status: "UNRESOLVED",
                        node_type: "CLAIM",
                        category: "claim",
                        evidence: cl.evidence,
                        isProposed: true
                    };
                    allItems.push(item);
                    proposedItemIds.add(item.id);
                });
            }
            const uniqueMap = new Map();
            allItems.forEach(item => {
                if (item.id && !uniqueMap.has(item.id)) {
                    uniqueMap.set(item.id, item);
                }
            });
            const ringBuckets = [[], [], []];
            uniqueMap.forEach(item => {
                const ringIdx = this.resolveRingIndex(item.node_type);
                ringBuckets[ringIdx].push(item);
            });
            ringBuckets.forEach((bucket, ringIdx) => {
                const count = bucket.length;
                bucket.forEach((item, i) => {
                    const angle = count > 0 ? (i / count) * Math.PI * 2 : 0;
                    const color = resolveNodeColor(item.node_type, item.status);
                    const geo = this.createNodeGeometry(item.node_type);
                    const mat = new THREE.MeshStandardMaterial({
                        color: color,
                        roughness: 0.28,
                        metalness: 0.45,
                        emissive: color,
                        emissiveIntensity: item.status === "PROPOSED" ? 0.45 : 0.25,
                        transparent: true,
                        opacity: 0.95
                    });
                    const mesh = new THREE.Mesh(geo, mat);
                    const hitGeo = new THREE.SphereGeometry(1.45, 12, 12);
                    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
                    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
                    hitMesh.userData = item;
                    const glowTex = createGlowTexture(color);
                    let glowSprite = null;
                    if (glowTex) {
                        const smat = new THREE.SpriteMaterial({ map: glowTex, color: color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false });
                        glowSprite = new THREE.Sprite(smat);
                        glowSprite.scale.set(2.6, 2.6, 1);
                        mesh.add(glowSprite);
                    }
                    let wireframe = null;
                    if (item.isProposed) {
                        const wfMat = new THREE.MeshBasicMaterial({ wireframe: true, color: color, transparent: true, opacity: 0.65 });
                        wireframe = new THREE.Mesh(geo, wfMat);
                        wireframe.scale.set(1.5, 1.5, 1.5);
                        mesh.add(wireframe);
                    }
                    this.graphGroup.add(mesh);
                    this.graphGroup.add(hitMesh);
                    const nodeRecord = {
                        id: item.id,
                        data: item,
                        mesh: mesh,
                        hitMesh: hitMesh,
                        glowSprite: glowSprite,
                        wireframe: wireframe,
                        ringIdx: ringIdx,
                        angle: angle,
                        targetAngle: angle,
                        angularVelocity: 0,
                        baseColor: color,
                        isProposed: Boolean(item.isProposed),
                        status: item.status,
                        layerMatch: true
                    };
                    this.nodes.set(item.id, nodeRecord);
                });
            });
            this.updateNodePositions();
            const relationsToBuild = [...rawRelations];
            if (isChangeSetPending && activeChangeSet.proposed_relations) {
                relationsToBuild.push(...activeChangeSet.proposed_relations);
            }
            relationsToBuild.forEach(rel => {
                const srcNode = this.nodes.get(rel.source_id);
                const tgtNode = this.nodes.get(rel.target_id);
                if (srcNode && tgtNode) {
                    const isProposed = rel.status === "PROPOSED" || srcNode.isProposed || tgtNode.isProposed;
                    const lineGeo = new THREE.BufferGeometry().setFromPoints([
                        srcNode.mesh.position.clone(),
                        tgtNode.mesh.position.clone()
                    ]);
                    const lineMat = new THREE.LineBasicMaterial({
                        color: isProposed ? PALETTE.amber : PALETTE.blue,
                        transparent: true,
                        opacity: isProposed ? 0.75 : 0.45,
                        linewidth: isProposed ? 2 : 1
                    });
                    const line = new THREE.Line(lineGeo, lineMat);
                    this.graphGroup.add(line);
                    this.edges.push({
                        data: rel,
                        sourceId: rel.source_id,
                        targetId: rel.target_id,
                        line: line,
                        isProposed: isProposed
                    });
                }
            });
            uniqueMap.forEach(item => {
                if (item.category === "claim" && item.concept_id) {
                    const parent = this.nodes.get(item.concept_id);
                    const claimNode = this.nodes.get(item.id);
                    if (parent && claimNode) {
                        const lineGeo = new THREE.BufferGeometry().setFromPoints([
                            claimNode.mesh.position.clone(),
                            parent.mesh.position.clone()
                        ]);
                        const isProposed = claimNode.isProposed || parent.isProposed;
                        const lineMat = new THREE.LineBasicMaterial({
                            color: isProposed ? PALETTE.amber : PALETTE.teal,
                            transparent: true,
                            opacity: 0.42
                        });
                        const line = new THREE.Line(lineGeo, lineMat);
                        this.graphGroup.add(line);
                        this.edges.push({
                            data: { source_id: item.id, target_id: item.concept_id, predicate: "grounded_in" },
                            sourceId: item.id,
                            targetId: item.concept_id,
                            line: line,
                            isProposed: isProposed
                        });
                    }
                }
            });
            const blackHolePos = new THREE.Vector3(-22, 0, 0);
            this.nodes.forEach(nodeRecord => {
                if (nodeRecord.isProposed) {
                    const threadGeo = new THREE.BufferGeometry().setFromPoints([
                        blackHolePos.clone(),
                        nodeRecord.mesh.position.clone()
                    ]);
                    const threadMat = new THREE.LineDashedMaterial({
                        color: PALETTE.amber,
                        dashSize: 0.6,
                        gapSize: 0.4,
                        transparent: true,
                        opacity: 0.6
                    });
                    const threadLine = new THREE.Line(threadGeo, threadMat);
                    threadLine.computeLineDistances();
                    this.graphGroup.add(threadLine);
                    this.inflowThreads.push({
                        nodeId: nodeRecord.id,
                        line: threadLine
                    });
                }
            });
            const whiteHolePos = new THREE.Vector3(22, 0, 0);
            this.nodes.forEach(nodeRecord => {
                if (nodeRecord.status === "VERIFIED" && (nodeRecord.data.node_type === "CLAIM" || nodeRecord.data.node_type === "CONCEPT")) {
                    const threadGeo = new THREE.BufferGeometry().setFromPoints([
                        nodeRecord.mesh.position.clone(),
                        whiteHolePos.clone()
                    ]);
                    const threadMat = new THREE.LineBasicMaterial({
                        color: PALETTE.teal,
                        transparent: true,
                        opacity: 0.25
                    });
                    const threadLine = new THREE.Line(threadGeo, threadMat);
                    this.graphGroup.add(threadLine);
                    this.synthesisThreads.push({
                        nodeId: nodeRecord.id,
                        line: threadLine
                    });
                }
            });
            const allLinks = [...this.edges, ...this.inflowThreads, ...this.synthesisThreads];
            allLinks.forEach(link => {
                this.edgePulses.push({ link, progress: Math.random() });
                this.edgePulses.push({ link, progress: Math.random() });
            });
            if (this.edgePulses.length > 0) {
                const pulseGeo = new THREE.BufferGeometry();
                const posArray = new Float32Array(this.edgePulses.length * 3);
                pulseGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
                const pulseMat = new THREE.PointsMaterial({
                    color: 0x7dd3fc,
                    map: getParticleTexture(),
                    size: 0.46,
                    transparent: true,
                    opacity: 0.9,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                this.edgeFlowSystem = new THREE.Points(pulseGeo, pulseMat);
                this.graphGroup.add(this.edgeFlowSystem);
            }
        }
        updateNodePositions() {
            this.nodes.forEach(nodeRecord => {
                const ringInfo = this.ringGroups[nodeRecord.ringIdx];
                const ringCfg = ringInfo.cfg;
                const angle = nodeRecord.angle;
                const localX = Math.cos(angle) * ringCfg.radius;
                const localY = Math.sin(angle) * ringCfg.radius;
                const pos = new THREE.Vector3(localX, localY, 0);
                pos.applyEuler(ringInfo.group.rotation);
                pos.x += ringInfo.group.position.x;
                pos.y += ringInfo.group.position.y;
                pos.z += ringInfo.group.position.z;
                nodeRecord.mesh.position.copy(pos);
                nodeRecord.hitMesh.position.copy(pos);
            });
        }
        updateOrbitalPhysics(delta) {
            if (this.isPaused) return;
            const ringNodes = [[], [], []];
            this.nodes.forEach(n => ringNodes[n.ringIdx].push(n));
            ringNodes.forEach((nodesInRing, ringIdx) => {
                const ringInfo = this.ringGroups[ringIdx];
                const count = nodesInRing.length;
                if (count <= 1) {
                    nodesInRing.forEach(n => { n.angle += ringInfo.cfg.speed * (delta * 60); });
                    return;
                }
                nodesInRing.forEach(n => { n.angle = (n.angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); });
                nodesInRing.sort((a, b) => a.angle - b.angle);
                const idealGap = (Math.PI * 2) / count;
                for (let i = 0; i < count; i++) {
                    const curr = nodesInRing[i];
                    const next = nodesInRing[(i + 1) % count];
                    let diff = next.angle - curr.angle;
                    if (diff < 0) diff += Math.PI * 2;
                    const gapError = diff - idealGap;
                    const springForce = gapError * 0.015;
                    curr.angularVelocity += springForce;
                    next.angularVelocity -= springForce;
                }
                nodesInRing.forEach(n => {
                    n.angularVelocity *= 0.92;
                    const effectiveSpeed = ringInfo.cfg.speed + n.angularVelocity;
                    n.angle += effectiveSpeed * (delta * 60);
                });
            });
            this.updateNodePositions();
            this.updateEdgeGeometries();
        }
        updateEdgeGeometries() {
            this.edges.forEach(edgeRecord => {
                const srcNode = this.nodes.get(edgeRecord.sourceId);
                const tgtNode = this.nodes.get(edgeRecord.targetId);
                if (srcNode && tgtNode) {
                    const p = edgeRecord.line.geometry.attributes.position;
                    p.setXYZ(0, srcNode.mesh.position.x, srcNode.mesh.position.y, srcNode.mesh.position.z);
                    p.setXYZ(1, tgtNode.mesh.position.x, tgtNode.mesh.position.y, tgtNode.mesh.position.z);
                    p.needsUpdate = true;
                }
            });
            this.inflowThreads.forEach(thread => {
                const node = this.nodes.get(thread.nodeId);
                if (node) {
                    const p = thread.line.geometry.attributes.position;
                    p.setXYZ(1, node.mesh.position.x, node.mesh.position.y, node.mesh.position.z);
                    p.needsUpdate = true;
                    if (thread.line.computeLineDistances) thread.line.computeLineDistances();
                }
            });
            this.synthesisThreads.forEach(thread => {
                const node = this.nodes.get(thread.nodeId);
                if (node) {
                    const p = thread.line.geometry.attributes.position;
                    p.setXYZ(0, node.mesh.position.x, node.mesh.position.y, node.mesh.position.z);
                    p.needsUpdate = true;
                }
            });
        }
        setExecutionStage(stage) {
            this.executionStage = stage || "Idle";
            this.isPaused = (this.executionStage === "Review");
            if (this.executionStage === "Ingest") {
                this.particleSpeedMultiplier = 2.2;
            } else if (this.executionStage === "Apply") {
                this.particleSpeedMultiplier = 2.5;
            } else {
                this.particleSpeedMultiplier = 1.0;
            }
        }
        setPaused(paused) {
            this.isPaused = Boolean(paused);
        }
        focusNode(nodeId) {
            const targetRecord = this.nodes.get(nodeId);
            if (!targetRecord) return;
            const oneHopNeighbors = new Set([nodeId]);
            this.edges.forEach(e => {
                if (e.sourceId === nodeId) oneHopNeighbors.add(e.targetId);
                if (e.targetId === nodeId) oneHopNeighbors.add(e.sourceId);
            });
            this.nodes.forEach((n, id) => {
                if (oneHopNeighbors.has(id)) {
                    n.mesh.material.opacity = 1.0;
                    n.mesh.scale.set(1.3, 1.3, 1.3);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.85;
                } else {
                    n.mesh.material.opacity = 0.2;
                    n.mesh.scale.set(0.85, 0.85, 0.85);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.2;
                }
            });
            if (this.controls) {
                const nodePos = targetRecord.mesh.position;
                this.controls.target.lerp(nodePos, 0.6);
                this.desiredControlTarget = nodePos.clone();
                this.desiredCameraPos = new THREE.Vector3(nodePos.x * 0.55, nodePos.y + 4.5, 24);
            }
        }
        traceToSource(nodeId) {
            const target = this.nodes.get(nodeId);
            if (!target) return { tracedNodeId: null, pathNodeIds: [] };
            this.tracedNodeId = nodeId;
            this.activeTracePath.clear();
            this.activeTraceEdges.clear();
            const pathNodeIds = [nodeId];
            this.activeTracePath.add(nodeId);
            this.edges.forEach(e => {
                if (e.sourceId === nodeId || e.targetId === nodeId) {
                    this.activeTracePath.add(e.sourceId);
                    this.activeTracePath.add(e.targetId);
                    this.activeTraceEdges.add(e);
                    if (!pathNodeIds.includes(e.sourceId)) pathNodeIds.push(e.sourceId);
                    if (!pathNodeIds.includes(e.targetId)) pathNodeIds.push(e.targetId);
                }
            });
            this.nodes.forEach((n, id) => {
                if (this.activeTracePath.has(id)) {
                    n.mesh.material.opacity = 1.0;
                    n.mesh.material.emissiveIntensity = 0.65;
                    n.mesh.scale.set(1.3, 1.3, 1.3);
                } else {
                    n.mesh.material.opacity = 0.16;
                    n.mesh.material.emissiveIntensity = 0.1;
                    n.mesh.scale.set(0.8, 0.8, 0.8);
                }
            });
            this.edges.forEach(e => {
                if (this.activeTraceEdges.has(e)) {
                    e.line.material.opacity = 0.95;
                    if (e.line.material.color && typeof e.line.material.color.setHex === "function") {
                        e.line.material.color.setHex(PALETTE.blue);
                    }
                } else {
                    e.line.material.opacity = 0.08;
                }
            });
            return { tracedNodeId: nodeId, pathNodeIds: pathNodeIds };
        }
        clearTrace() {
            this.tracedNodeId = null;
            this.activeTracePath.clear();
            this.activeTraceEdges.clear();
            this.highlightedNodeIds.clear();
            this.setLayerFilter(this.activeLayerFilter);
        }
        highlightNodes(nodeIds = []) {
            this.highlightedNodeIds = new Set(nodeIds);
            if (nodeIds.length === 0) {
                this.clearTrace();
                return;
            }
            this.nodes.forEach((n, id) => {
                if (this.highlightedNodeIds.has(id)) {
                    n.mesh.material.opacity = 1.0;
                    n.mesh.material.emissiveIntensity = 0.7;
                    n.mesh.scale.set(1.35, 1.35, 1.35);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.85;
                } else {
                    n.mesh.material.opacity = 0.2;
                    n.mesh.scale.set(0.85, 0.85, 0.85);
                    if (n.glowSprite) n.glowSprite.material.opacity = 0.2;
                }
            });
        }
        triggerAbsorptionAnimation(approvedIds = []) {
            const ids = new Set(approvedIds);
            const burstParticles = [];
            this.nodes.forEach((n, id) => {
                if (ids.has(id) || approvedIds.length === 0) {
                    const targetColor = (n.data.node_type === "CLAIM" || n.data.node_type === "TERM") ? PALETTE.blue : PALETTE.teal;
                    n.baseColor = targetColor;
                    n.isProposed = false;
                    n.data.status = "VERIFIED";
                    if (n.wireframe && n.wireframe.parent) n.mesh.remove(n.wireframe);
                    this.animatingAbsorptions.push({
                        mesh: n.mesh,
                        startColor: new THREE.Color(PALETTE.amber),
                        endColor: new THREE.Color(targetColor),
                        progress: 0,
                        duration: 1.2
                    });
                    for (let p = 0; p < 8; p++) {
                        burstParticles.push({
                            pos: n.mesh.position.clone(),
                            vel: new THREE.Vector3(
                                0.25 + Math.random() * 0.35,
                                (Math.random() - 0.5) * 0.2,
                                (Math.random() - 0.5) * 0.2
                            ),
                            life: 1.0
                        });
                    }
                }
            });
            if (burstParticles.length > 0) {
                const burstGeo = new THREE.BufferGeometry();
                const posArray = new Float32Array(burstParticles.length * 3);
                burstGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
                const burstMat = new THREE.PointsMaterial({
                    color: PALETTE.teal,
                    map: getParticleTexture(),
                    size: 0.48,
                    transparent: true,
                    opacity: 0.9,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                const pSystem = new THREE.Points(burstGeo, burstMat);
                this.scene.add(pSystem);
                this.animatingAbsorptions.push({
                    type: "burst",
                    system: pSystem,
                    particles: burstParticles,
                    progress: 0,
                    duration: 1.6
                });
            }
        }
        resetView() {
            this.desiredCameraPos = null;
            this.desiredControlTarget = null;
            if (this.camera && this.defaultCameraPos) {
                this.camera.position.copy(this.defaultCameraPos);
            }
            if (this.controls && this.defaultTargetPos) {
                this.controls.target.copy(this.defaultTargetPos);
                this.controls.update();
            }
            this.clearTrace();
        }
        getDiagnostics() {
            const bhVisible = this.isPortalInViewport(-22, 0, 0);
            const whVisible = this.isPortalInViewport(22, 0, 0);
            const bhScreen = this.projectToScreen(-22, 0, 0);
            const whScreen = this.projectToScreen(22, 0, 0);
            return {
                blackHoleVisible: bhVisible,
                whiteHoleVisible: whVisible,
                blackHoleScreenX: bhScreen ? bhScreen.x : -1,
                whiteHoleScreenX: whScreen ? whScreen.x : -1,
                nodeCount: this.nodes.size,
                edgeCount: this.edges.length,
                isPaused: this.isPaused,
                executionStage: this.executionStage,
                tracedNodeId: this.tracedNodeId,
                activeLayerFilter: this.activeLayerFilter
            };
        }
        isPortalInViewport(x, y, z) {
            if (!this.camera) return false;
            const vec = new THREE.Vector3(x, y, z);
            vec.project(this.camera);
            return (vec.x >= -1.0 && vec.x <= 1.0 && vec.y >= -1.0 && vec.y <= 1.0 && vec.z >= -1.0 && vec.z <= 1.0);
        }
        projectToScreen(x, y, z) {
            if (!this.camera || !this.container) return null;
            const vec = new THREE.Vector3(x, y, z);
            vec.project(this.camera);
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;
            return {
                x: (vec.x * 0.5 + 0.5) * width,
                y: (-vec.y * 0.5 + 0.5) * height
            };
        }
        startRenderLoop() {
            const loop = () => {
                requestAnimationFrame(loop);
                this.renderFrame();
            };
            requestAnimationFrame(loop);
        }
        renderFrame() {
            const delta = Math.min(this.clock.getDelta(), 0.1);
            const elapsed = this.clock.getElapsedTime();
            const spdMult = this.particleSpeedMultiplier || 1.0;
            if (this.desiredCameraPos) {
                this.camera.position.lerp(this.desiredCameraPos, delta * 1.5);
            }
            if (this.desiredControlTarget && this.controls) {
                this.controls.target.lerp(this.desiredControlTarget, delta * 1.5);
            }
            if (this.ambientDust && this.ambientDust.geometry) {
                const pos = this.ambientDust.geometry.attributes.position.array;
                for(let i=0; i<pos.length; i+=3) {
                    pos[i] += delta * 0.2;
                    pos[i+1] += delta * 0.05;
                    if(pos[i] > 30) pos[i] = -30;
                    if(pos[i+1] > 12) pos[i+1] = -12;
                }
                this.ambientDust.geometry.attributes.position.needsUpdate = true;
            }
            if (this.blackHoleGroup && this.bhVortexParticles) {
                const pos = this.bhVortexParticles.geometry.attributes.position.array;
                for (let i = 0; i < this.bhVortexData.length; i++) {
                    const pd = this.bhVortexData[i];
                    pd.progress = (pd.progress + pd.speed * spdMult * (delta * 60)) % 1.0;
                    pd.angle += pd.spin * spdMult * (delta * 60);
                    const x = -11.0 + pd.progress * 16.0;
                    const funnelEnvelope = Math.max(0.18, 1.0 - pd.progress * 0.82);
                    const r = pd.rSpread * funnelEnvelope;
                    pos[i * 3 + 0] = x;
                    pos[i * 3 + 1] = Math.cos(pd.angle) * r;
                    pos[i * 3 + 2] = Math.sin(pd.angle) * r;
                }
                this.bhVortexParticles.geometry.attributes.position.needsUpdate = true;
            }
            if (this.bhDisk1) this.bhDisk1.rotation.z += delta * 0.45 * spdMult;
            if (this.bhDisk2) this.bhDisk2.rotation.z -= delta * 0.32 * spdMult;
            if (this.whRing1) this.whRing1.rotation.z += delta * 0.38 * spdMult;
            if (this.whRing2) this.whRing2.rotation.y -= delta * 0.28 * spdMult;
            if (this.whiteHoleGroup && this.whFountainParticles) {
                const pos = this.whFountainParticles.geometry.attributes.position.array;
                for (let i = 0; i < this.whFountainData.length; i++) {
                    const fd = this.whFountainData[i];
                    fd.progress = (fd.progress + fd.speed * spdMult * (delta * 60)) % 1.0;
                    fd.angle += fd.spin * spdMult * (delta * 60);
                    const x = -5.0 + fd.progress * 16.0;
                    const coneEnvelope = 0.16 + fd.progress * 0.84;
                    const r = fd.rSpread * coneEnvelope;
                    pos[i * 3 + 0] = x;
                    pos[i * 3 + 1] = Math.cos(fd.angle) * r;
                    pos[i * 3 + 2] = Math.sin(fd.angle) * r;
                }
                this.whFountainParticles.geometry.attributes.position.needsUpdate = true;
            }
            if (this.globalStreamParticles) {
                const pos = this.globalStreamParticles.geometry.attributes.position.array;
                for (let i = 0; i < this.globalStreamData.length; i++) {
                    const gd = this.globalStreamData[i];
                    gd.x += gd.speed * spdMult;
                    if (gd.x > 22) {
                        gd.x = -22;
                    }
                    const flowPinch = Math.max(0.1, 1.0 - Math.pow(Math.abs(gd.x) / 22, 2));
                    pos[i * 3 + 0] = gd.x;
                    pos[i * 3 + 1] = gd.y * flowPinch;
                    pos[i * 3 + 2] = gd.z * flowPinch;
                }
                this.globalStreamParticles.geometry.attributes.position.needsUpdate = true;
            }
            this.updateOrbitalPhysics(delta);
            const pulseScale = 1.0 + 0.08 * Math.sin(elapsed * 4.5);
            this.nodes.forEach((n, id) => {
                if (n.isProposed && !this.tracedNodeId && this.highlightedNodeIds.size === 0) {
                    n.mesh.scale.set(pulseScale, pulseScale, pulseScale);
                }
                if (n.wireframe) {
                    n.wireframe.rotation.y -= delta * 0.5;
                    n.wireframe.rotation.z += delta * 0.3;
                    n.wireframe.scale.set(1.38 + 0.05 * Math.sin(elapsed * 3), 1.38 + 0.05 * Math.sin(elapsed * 3), 1.38 + 0.05 * Math.sin(elapsed * 3));
                }
            });
            if (this.edgeFlowSystem && this.edgePulses.length > 0) {
                const posArray = this.edgeFlowSystem.geometry.attributes.position.array;
                let activePulseCount = 0;
                for (let i = 0; i < this.edgePulses.length; i++) {
                    const p = this.edgePulses[i];
                    let speed = 0.3;
                    if (this.highlightedNodeIds.has(p.link.sourceId) || this.highlightedNodeIds.has(p.link.targetId) || this.activeTraceEdges.has(p.link)) speed = 1.0;
                    p.progress = (p.progress + delta * speed) % 1.0;
                    let p1, p2;
                    if (p.link.line && p.link.line.geometry) {
                        const pts = p.link.line.geometry.attributes.position;
                        if (pts.count >= 2) {
                            p1 = new THREE.Vector3(pts.getX(0), pts.getY(0), pts.getZ(0));
                            p2 = new THREE.Vector3(pts.getX(1), pts.getY(1), pts.getZ(1));
                        }
                    }
                    if (p1 && p2) {
                        const cur = p1.clone().lerp(p2, p.progress);
                        posArray[i * 3] = cur.x;
                        posArray[i * 3 + 1] = cur.y;
                        posArray[i * 3 + 2] = cur.z;
                        activePulseCount++;
                    }
                }
                if (activePulseCount > 0) this.edgeFlowSystem.geometry.attributes.position.needsUpdate = true;
            }
            for (let i = this.animatingAbsorptions.length - 1; i >= 0; i--) {
                const anim = this.animatingAbsorptions[i];
                anim.progress += delta / anim.duration;
                if (anim.type === "burst") {
                    const pPositions = anim.system.geometry.attributes.position.array;
                    const particles = anim.particles;
                    for (let pIdx = 0; pIdx < particles.length; pIdx++) {
                        const pt = particles[pIdx];
                        pt.pos.add(pt.vel);
                        pPositions[pIdx * 3 + 0] = pt.pos.x;
                        pPositions[pIdx * 3 + 1] = pt.pos.y;
                        pPositions[pIdx * 3 + 2] = pt.pos.z;
                    }
                    anim.system.geometry.attributes.position.needsUpdate = true;
                    anim.system.material.opacity = Math.max(0, 0.9 * (1.0 - anim.progress));
                    if (anim.progress >= 1.0) {
                        this.scene.remove(anim.system);
                        this.animatingAbsorptions.splice(i, 1);
                    }
                } else {
                    const t = Math.min(1.0, anim.progress);
                    const curColor = anim.startColor.clone().lerp(anim.endColor, t);
                    anim.mesh.material.color.copy(curColor);
                    anim.mesh.material.emissive.copy(curColor);
                    if (anim.progress >= 1.0) {
                        this.animatingAbsorptions.splice(i, 1);
                    }
                }
            }
            if (this.controls) {
                this.controls.update();
            }
            this.updateLabels();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        }
    }
    return IdeaSceneManager;
}));
