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
        canvas: 0xf7f9fc,
        portalDark: 0x18212c,
        blue: 0x4285f4,
        red: 0xea4335,
        yellow: 0xfbbc05,
        green: 0x34a853,
        border: 0xdadce0,
        muted: 0x5f6368,
        ink: 0x202124,
        white: 0xffffff
    };

    function resolveNodeColor(nodeType, status) {
        const s = (status || "").toUpperCase();
        if (s === "UNRESOLVED") return PALETTE.red;
        if (s === "PROPOSED" || s === "PENDING" || s === "NEEDS_REVIEW") return PALETTE.yellow;
        if (s === "REJECTED" || s === "BLOCKED") return PALETTE.muted;

        const t = (nodeType || "").toUpperCase();
        if (t === "TERM" || t === "CLAIM") {
            return PALETTE.blue;
        }
        return PALETTE.green;
    }

    class IdeaSceneManager {
        constructor(containerEl, callbacks = {}) {
            if (!containerEl) {
                throw new Error("IdeaSceneManager requires a valid container element");
            }
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

            this.nodes = new Map();
            this.edges = [];
            this.inflowThreads = [];
            this.synthesisThreads = [];

            this.rings = [
                { id: "ring_terms", x: -7.5, radius: 7.2, tilt: 0.18, speed: 0.0035, type: "TERM", label: "Domain Terms" },
                { id: "ring_concepts", x: 0.0, radius: 9.2, tilt: -0.12, speed: -0.0025, type: "CONCEPT", label: "Concepts & Entities" },
                { id: "ring_claims", x: 7.5, radius: 7.8, tilt: 0.22, speed: 0.0030, type: "CLAIM", label: "Grounded Claims" }
            ];

            this.clock = new (typeof THREE !== "undefined" ? THREE.Clock : class { getDelta() { return 0.016; } getElapsedTime() { return 0; } })();
            this.animatingAbsorptions = [];

            this.pointerDownPos = { x: 0, y: 0 };
            this.pointerDownTime = 0;
            this.isPointerDown = false;

            if (typeof THREE !== "undefined") {
                this.initThree();
                this.buildEnvironment();
                this.buildBlackHole();
                this.buildWhiteHole();
                this.buildOrbitalTracks();
                this.initLabelsOverlay();
                this.bindEvents();
                this.startRenderLoop();
            } else {
                console.warn("THREE.js is not defined yet. IdeaSceneManager initialized in deferred mode.");
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

            const ambient = new THREE.AmbientLight(0xffffff, 0.82);
            this.scene.add(ambient);

            const keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
            keyLight.position.set(15, 30, 25);
            this.scene.add(keyLight);

            const fillLight = new THREE.DirectionalLight(PALETTE.blue, 0.35);
            fillLight.position.set(-25, 10, -10);
            this.scene.add(fillLight);

            const softGreenLight = new THREE.DirectionalLight(PALETTE.green, 0.3);
            softGreenLight.position.set(25, -10, 10);
            this.scene.add(softGreenLight);

            this.graphGroup = new THREE.Group();
            this.scene.add(this.graphGroup);
        }

        buildEnvironment() {
            const gridHelper = new THREE.GridHelper(64, 32, PALETTE.border, 0xe4e8f0);
            gridHelper.position.y = -10.5;
            gridHelper.material.opacity = 0.35;
            gridHelper.material.transparent = true;
            this.scene.add(gridHelper);

            const dustCount = 140;
            const dustGeo = new THREE.BufferGeometry();
            const dustPos = new Float32Array(dustCount * 3);
            for (let i = 0; i < dustCount; i++) {
                dustPos[i * 3 + 0] = (Math.random() - 0.5) * 60;
                dustPos[i * 3 + 1] = (Math.random() - 0.5) * 24;
                dustPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
            }
            dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
            const dustMat = new THREE.PointsMaterial({
                color: PALETTE.muted,
                size: 0.25,
                transparent: true,
                opacity: 0.28
            });
            this.ambientDust = new THREE.Points(dustGeo, dustMat);
            this.scene.add(this.ambientDust);
        }

        buildBlackHole() {
            this.blackHoleGroup = new THREE.Group();
            this.blackHoleGroup.position.set(-22, 0, 0);

            const coreGeo = new THREE.SphereGeometry(2.4, 36, 36);
            const coreMat = new THREE.MeshStandardMaterial({
                color: PALETTE.portalDark,
                roughness: 0.3,
                metalness: 0.9,
                emissive: 0x0a0e14,
                emissiveIntensity: 0.6
            });
            this.blackHoleCore = new THREE.Mesh(coreGeo, coreMat);
            this.blackHoleGroup.add(this.blackHoleCore);

            const hitGeo = new THREE.SphereGeometry(3.2, 16, 16);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
            this.blackHoleHitMesh = new THREE.Mesh(hitGeo, hitMat);
            this.blackHoleHitMesh.userData = {
                id: "portal_black_hole",
                name: "Black Hole · Source Input",
                node_type: "PORTAL",
                role: "source_portal",
                description: "Ingests external URLs and technical documents into candidate knowledge orbits."
            };
            this.blackHoleGroup.add(this.blackHoleHitMesh);

            const disk1Geo = new THREE.RingGeometry(2.6, 4.3, 48);
            const disk1Mat = new THREE.MeshBasicMaterial({
                color: PALETTE.blue,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.65
            });
            this.bhDisk1 = new THREE.Mesh(disk1Geo, disk1Mat);
            this.bhDisk1.rotation.x = Math.PI / 2.6;
            this.bhDisk1.rotation.y = 0.25;
            this.blackHoleGroup.add(this.bhDisk1);

            const disk2Geo = new THREE.RingGeometry(3.8, 5.2, 48);
            const disk2Mat = new THREE.MeshBasicMaterial({
                color: PALETTE.red,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.45
            });
            this.bhDisk2 = new THREE.Mesh(disk2Geo, disk2Mat);
            this.bhDisk2.rotation.x = -Math.PI / 2.4;
            this.bhDisk2.rotation.z = 0.35;
            this.blackHoleGroup.add(this.bhDisk2);

            const pCount = 260;
            const pPositions = new Float32Array(pCount * 3);
            this.bhParticleAngles = new Float32Array(pCount);
            this.bhParticleRadii = new Float32Array(pCount);
            this.bhParticleSpeeds = new Float32Array(pCount);
            this.bhParticleHeights = new Float32Array(pCount);

            for (let i = 0; i < pCount; i++) {
                this.bhParticleAngles[i] = Math.random() * Math.PI * 2;
                this.bhParticleRadii[i] = 2.6 + Math.random() * 5.5;
                this.bhParticleSpeeds[i] = 0.015 + Math.random() * 0.035;
                this.bhParticleHeights[i] = (Math.random() - 0.5) * 2.2;

                pPositions[i * 3 + 0] = Math.cos(this.bhParticleAngles[i]) * this.bhParticleRadii[i];
                pPositions[i * 3 + 1] = this.bhParticleHeights[i];
                pPositions[i * 3 + 2] = Math.sin(this.bhParticleAngles[i]) * this.bhParticleRadii[i];
            }

            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: PALETTE.blue,
                size: 0.32,
                transparent: true,
                opacity: 0.75,
                blending: THREE.AdditiveBlending
            });
            this.bhInflowParticles = new THREE.Points(pGeo, pMat);
            this.blackHoleGroup.add(this.bhInflowParticles);

            this.scene.add(this.blackHoleGroup);
        }

        buildWhiteHole() {
            this.whiteHoleGroup = new THREE.Group();
            this.whiteHoleGroup.position.set(22, 0, 0);

            const coreGeo = new THREE.SphereGeometry(2.2, 36, 36);
            const coreMat = new THREE.MeshStandardMaterial({
                color: PALETTE.portalDark,
                roughness: 0.25,
                metalness: 0.85,
                emissive: 0x0f281e,
                emissiveIntensity: 0.5
            });
            this.whiteHoleCore = new THREE.Mesh(coreGeo, coreMat);
            this.whiteHoleGroup.add(this.whiteHoleCore);

            const hitGeo = new THREE.SphereGeometry(3.2, 16, 16);
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

            const ring1Geo = new THREE.RingGeometry(2.4, 4.4, 48);
            const ring1Mat = new THREE.MeshBasicMaterial({
                color: PALETTE.green,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.65
            });
            this.whRing1 = new THREE.Mesh(ring1Geo, ring1Mat);
            this.whRing1.rotation.x = Math.PI / 2.3;
            this.whRing1.rotation.y = -0.2;
            this.whiteHoleGroup.add(this.whRing1);

            const ring2Geo = new THREE.RingGeometry(3.6, 5.4, 48);
            const ring2Mat = new THREE.MeshBasicMaterial({
                color: PALETTE.blue,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.45
            });
            this.whRing2 = new THREE.Mesh(ring2Geo, ring2Mat);
            this.whRing2.rotation.x = -Math.PI / 2.5;
            this.whRing2.rotation.z = -0.25;
            this.whiteHoleGroup.add(this.whRing2);

            const pCount = 260;
            const pPositions = new Float32Array(pCount * 3);
            this.whParticleAngles = new Float32Array(pCount);
            this.whParticleRadii = new Float32Array(pCount);
            this.whParticleSpeeds = new Float32Array(pCount);
            this.whParticleHeights = new Float32Array(pCount);

            for (let i = 0; i < pCount; i++) {
                this.whParticleAngles[i] = Math.random() * Math.PI * 2;
                this.whParticleRadii[i] = 2.4 + Math.random() * 5.0;
                this.whParticleSpeeds[i] = 0.02 + Math.random() * 0.04;
                this.whParticleHeights[i] = (Math.random() - 0.5) * 2.2;

                pPositions[i * 3 + 0] = Math.cos(this.whParticleAngles[i]) * this.whParticleRadii[i];
                pPositions[i * 3 + 1] = this.whParticleHeights[i];
                pPositions[i * 3 + 2] = Math.sin(this.whParticleAngles[i]) * this.whParticleRadii[i];
            }

            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: PALETTE.green,
                size: 0.32,
                transparent: true,
                opacity: 0.75,
                blending: THREE.AdditiveBlending
            });
            this.whOutflowParticles = new THREE.Points(pGeo, pMat);
            this.whiteHoleGroup.add(this.whOutflowParticles);

            this.scene.add(this.whiteHoleGroup);
        }

        buildOrbitalTracks() {
            this.ringGroups = [];

            this.rings.forEach(ringCfg => {
                const group = new THREE.Group();
                group.position.set(ringCfg.x, 0, 0);
                group.rotation.z = ringCfg.tilt;

                const trackGeo = new THREE.TorusGeometry(ringCfg.radius, 0.045, 12, 80);
                const trackMat = new THREE.MeshBasicMaterial({
                    color: PALETTE.border,
                    transparent: true,
                    opacity: 0.45
                });
                const trackMesh = new THREE.Mesh(trackGeo, trackMat);
                trackMesh.rotation.y = Math.PI / 2;
                group.add(trackMesh);

                this.scene.add(group);
                this.ringGroups.push({
                    cfg: ringCfg,
                    group: group,
                    currentAngle: 0
                });
            });
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
        }

        updateLabels() {
            if (!this.labelsOverlay || !this.camera) return;

            const maxVisible = 18;
            let visibleCount = 0;
            const tempVec = new THREE.Vector3();
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;

            this.nodes.forEach((nodeRecord, id) => {
                let el = this.labelElements.get(id);
                if (!el) {
                    el = document.createElement("div");
                    el.className = "idea-3d-node-label";
                    Object.assign(el.style, {
                        position: "absolute",
                        fontSize: "11px",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        fontWeight: "600",
                        padding: "2px 7px",
                        borderRadius: "8px",
                        background: "rgba(255, 255, 255, 0.88)",
                        backdropFilter: "blur(6px)",
                        border: "1px solid rgba(218, 220, 224, 0.9)",
                        color: "#202124",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                        transform: "translate(-50%, -130%)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        transition: "opacity 0.15s ease",
                        display: "none"
                    });
                    const rawName = nodeRecord.data.name || nodeRecord.data.statement || id;
                    el.textContent = rawName.length > 22 ? rawName.slice(0, 21) + "…" : rawName;
                    this.labelsOverlay.appendChild(el);
                    this.labelElements.set(id, el);
                }

                if (visibleCount >= maxVisible || nodeRecord.mesh.visible === false) {
                    el.style.display = "none";
                    return;
                }

                nodeRecord.mesh.getWorldPosition(tempVec);
                const camDir = this.camera.getWorldDirection(new THREE.Vector3());
                const toNode = tempVec.clone().sub(this.camera.position);
                const inFront = toNode.dot(camDir) > 0;

                if (!inFront) {
                    el.style.display = "none";
                    return;
                }

                tempVec.project(this.camera);

                if (tempVec.x < -0.92 || tempVec.x > 0.92 || tempVec.y < -0.92 || tempVec.y > 0.92 || tempVec.z > 1) {
                    el.style.display = "none";
                    return;
                }

                const screenX = (tempVec.x * 0.5 + 0.5) * width;
                const screenY = (-tempVec.y * 0.5 + 0.5) * height;

                el.style.left = `${screenX}px`;
                el.style.top = `${screenY}px`;
                el.style.display = "block";

                if (this.tracedNodeId && !this.activeTracePath.has(id)) {
                    el.style.opacity = "0.2";
                } else {
                    el.style.opacity = "0.95";
                }

                visibleCount++;
            });
        }

        bindEvents() {
            const dom = this.renderer.domElement;

            dom.addEventListener("pointerdown", (e) => {
                this.isPointerDown = true;
                this.pointerDownPos = { x: e.clientX, y: e.clientY };
                this.pointerDownTime = performance.now();
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
            if (t === "TERM") {
                return new THREE.OctahedronGeometry(1.05, 0);
            }
            if (t === "ENTITY") {
                return new THREE.BoxGeometry(1.25, 1.25, 1.25);
            }
            if (t === "CLAIM") {
                return new THREE.TorusGeometry(0.85, 0.32, 16, 28);
            }
            return new THREE.SphereGeometry(1.05, 24, 24);
        }

        resolveRingIndex(nodeType) {
            const t = (nodeType || "").toUpperCase();
            if (t === "TERM") return 0;
            if (t === "CLAIM") return 2;
            return 1;
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

            if (this.labelsOverlay) {
                this.labelsOverlay.innerHTML = "";
            }
            this.labelElements.clear();

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
                const ringCfg = this.rings[ringIdx];
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

                    this.graphGroup.add(mesh);
                    this.graphGroup.add(hitMesh);

                    const nodeRecord = {
                        id: item.id,
                        data: item,
                        mesh: mesh,
                        hitMesh: hitMesh,
                        ringIdx: ringIdx,
                        angle: angle,
                        targetAngle: angle,
                        angularVelocity: 0,
                        baseColor: color,
                        isProposed: Boolean(item.isProposed),
                        status: item.status
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
                        color: isProposed ? PALETTE.yellow : PALETTE.blue,
                        transparent: true,
                        opacity: isProposed ? 0.7 : 0.4,
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
                            color: isProposed ? PALETTE.yellow : PALETTE.green,
                            transparent: true,
                            opacity: 0.35
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
                        color: PALETTE.yellow,
                        dashSize: 0.6,
                        gapSize: 0.4,
                        transparent: true,
                        opacity: 0.55
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
                        color: PALETTE.green,
                        transparent: true,
                        opacity: 0.22
                    });
                    const threadLine = new THREE.Line(threadGeo, threadMat);
                    this.graphGroup.add(threadLine);
                    this.synthesisThreads.push({
                        nodeId: nodeRecord.id,
                        line: threadLine
                    });
                }
            });
        }

        updateNodePositions() {
            this.nodes.forEach(nodeRecord => {
                const ringCfg = this.rings[nodeRecord.ringIdx];
                const angle = nodeRecord.angle;

                const yRaw = Math.sin(angle) * ringCfg.radius;
                const zRaw = Math.cos(angle) * ringCfg.radius;

                const cosTilt = Math.cos(ringCfg.tilt);
                const sinTilt = Math.sin(ringCfg.tilt);

                const x = ringCfg.x - yRaw * sinTilt;
                const y = yRaw * cosTilt;
                const z = zRaw;

                nodeRecord.mesh.position.set(x, y, z);
                nodeRecord.hitMesh.position.set(x, y, z);
            });
        }

        updateOrbitalPhysics(delta) {
            if (this.isPaused) return;

            const ringNodes = [[], [], []];
            this.nodes.forEach(n => ringNodes[n.ringIdx].push(n));

            ringNodes.forEach((nodesInRing, ringIdx) => {
                const ringCfg = this.rings[ringIdx];
                const count = nodesInRing.length;
                if (count <= 1) {
                    nodesInRing.forEach(n => {
                        n.angle += ringCfg.speed * (delta * 60);
                    });
                    return;
                }

                nodesInRing.forEach(n => {
                    n.angle = (n.angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
                });
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
                    const effectiveSpeed = ringCfg.speed + n.angularVelocity;
                    n.angle += effectiveSpeed * (delta * 60);
                });
            });

            this.updateNodePositions();
            this.updateEdgeGeometries();
        }

        updateEdgeGeometries() {
            const posArray = new Float32Array(6);
            this.edges.forEach(edgeRecord => {
                const srcNode = this.nodes.get(edgeRecord.sourceId);
                const tgtNode = this.nodes.get(edgeRecord.targetId);
                if (srcNode && tgtNode) {
                    const geo = edgeRecord.line.geometry;
                    const p = geo.attributes.position;
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
                    n.mesh.scale.set(1.25, 1.25, 1.25);
                } else {
                    n.mesh.material.opacity = 0.22;
                    n.mesh.scale.set(0.85, 0.85, 0.85);
                }
            });

            if (this.controls) {
                const nodePos = targetRecord.mesh.position;
                this.controls.target.lerp(nodePos, 0.6);
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
                    e.line.material.color.setHex(PALETTE.blue);
                } else {
                    e.line.material.opacity = 0.08;
                }
            });

            return {
                tracedNodeId: nodeId,
                pathNodeIds: pathNodeIds
            };
        }

        clearTrace() {
            this.tracedNodeId = null;
            this.activeTracePath.clear();
            this.activeTraceEdges.clear();
            this.highlightedNodeIds.clear();

            this.nodes.forEach(n => {
                n.mesh.material.opacity = 0.95;
                n.mesh.material.emissiveIntensity = n.isProposed ? 0.45 : 0.25;
                if (n.mesh.material.color && typeof n.mesh.material.color.setHex === "function") {
                    n.mesh.material.color.setHex(n.baseColor);
                } else if (n.mesh.material.color && typeof n.mesh.material.color.set === "function") {
                    n.mesh.material.color.set(n.baseColor);
                }
                n.mesh.scale.set(1.0, 1.0, 1.0);
            });

            this.edges.forEach(e => {
                e.line.material.opacity = e.isProposed ? 0.7 : 0.4;
                const targetCol = e.isProposed ? PALETTE.yellow : PALETTE.blue;
                if (e.line.material.color && typeof e.line.material.color.setHex === "function") {
                    e.line.material.color.setHex(targetCol);
                } else if (e.line.material.color && typeof e.line.material.color.set === "function") {
                    e.line.material.color.set(targetCol);
                }
            });
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
                } else {
                    n.mesh.material.opacity = 0.2;
                    n.mesh.scale.set(0.85, 0.85, 0.85);
                }
            });
        }

        triggerAbsorptionAnimation(approvedIds = []) {
            const ids = new Set(approvedIds);
            const burstParticles = [];

            this.nodes.forEach((n, id) => {
                if (ids.has(id) || approvedIds.length === 0) {
                    const targetColor = (n.data.node_type === "CLAIM" || n.data.node_type === "TERM") ? PALETTE.blue : PALETTE.green;
                    n.baseColor = targetColor;
                    n.isProposed = false;
                    n.data.status = "VERIFIED";

                    this.animatingAbsorptions.push({
                        mesh: n.mesh,
                        startColor: new THREE.Color(PALETTE.yellow),
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
                    color: PALETTE.green,
                    size: 0.45,
                    transparent: true,
                    opacity: 0.9,
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
                tracedNodeId: this.tracedNodeId
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

            if (this.blackHoleGroup) {
                if (this.bhDisk1) this.bhDisk1.rotation.z += 0.012;
                if (this.bhDisk2) this.bhDisk2.rotation.z -= 0.008;

                if (this.bhInflowParticles) {
                    const pos = this.bhInflowParticles.geometry.attributes.position.array;
                    const pCount = this.bhParticleRadii.length;
                    for (let i = 0; i < pCount; i++) {
                        this.bhParticleAngles[i] += this.bhParticleSpeeds[i] * spdMult;
                        this.bhParticleRadii[i] -= 0.015 * spdMult;
                        if (this.bhParticleRadii[i] < 2.5) {
                            this.bhParticleRadii[i] = 7.8 + Math.random() * 1.5;
                        }
                        pos[i * 3 + 0] = Math.cos(this.bhParticleAngles[i]) * this.bhParticleRadii[i];
                        pos[i * 3 + 1] = this.bhParticleHeights[i];
                        pos[i * 3 + 2] = Math.sin(this.bhParticleAngles[i]) * this.bhParticleRadii[i];
                    }
                    this.bhInflowParticles.geometry.attributes.position.needsUpdate = true;
                }
            }

            if (this.whiteHoleGroup) {
                if (this.whRing1) this.whRing1.rotation.z += 0.010;
                if (this.whRing2) this.whRing2.rotation.z -= 0.007;

                if (this.whOutflowParticles) {
                    const pos = this.whOutflowParticles.geometry.attributes.position.array;
                    const pCount = this.whParticleRadii.length;
                    for (let i = 0; i < pCount; i++) {
                        this.whParticleAngles[i] += this.whParticleSpeeds[i] * spdMult;
                        this.whParticleRadii[i] += 0.018 * spdMult;
                        if (this.whParticleRadii[i] > 7.8) {
                            this.whParticleRadii[i] = 2.4 + Math.random() * 0.5;
                        }
                        pos[i * 3 + 0] = Math.cos(this.whParticleAngles[i]) * this.whParticleRadii[i];
                        pos[i * 3 + 1] = this.whParticleHeights[i];
                        pos[i * 3 + 2] = Math.sin(this.whParticleAngles[i]) * this.whParticleRadii[i];
                    }
                    this.whOutflowParticles.geometry.attributes.position.needsUpdate = true;
                }
            }

            this.updateOrbitalPhysics(delta);

            const pulseScale = 1.0 + 0.08 * Math.sin(elapsed * 4.5);
            this.nodes.forEach(n => {
                if (n.isProposed && !this.tracedNodeId && this.highlightedNodeIds.size === 0) {
                    n.mesh.scale.set(pulseScale, pulseScale, pulseScale);
                }
            });

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
