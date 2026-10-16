let scene, camera, renderer, controls;
let nodes = [];
let lines = [];
let currentChangeSetId = null;

// Initialize 3D Scene
function init3D() {
    const container = document.getElementById("canvas-container");
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0f19, 0.015);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 15, 35);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    // Create 4 Layer Planes
    createLayerPlanes();

    // Raycaster for click interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    window.addEventListener("click", (e) => {
        if (e.target.closest(".glass-panel") || e.target.closest("button") || e.target.closest("input")) return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(nodes.map(n => n.mesh));
        if (intersects.length > 0) {
            const hit = nodes.find(n => n.mesh === intersects[0].object);
            if (hit) showNodeModal(hit.data);
        }
    });

    window.addEventListener("resize", onWindowResize);
    animate();
}

function createLayerPlanes() {
    // 4 Layers: Y = 12 (Wiki), Y = 4 (Graph), Y = -4 (Domain), Y = -12 (Source)
    const layers = [
        { y: 12, color: 0x38bdf8, name: "Living Wiki" },
        { y: 4, color: 0x34d399, name: "Knowledge Graph" },
        { y: -4, color: 0x818cf8, name: "Domain Ontology" },
        { y: -12, color: 0xfbbf24, name: "Source Evidence" }
    ];

    layers.forEach(l => {
        const grid = new THREE.GridHelper(30, 20, l.color, 0x1e293b);
        grid.position.y = l.y;
        scene.add(grid);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Gentle node floating / rotation
    nodes.forEach(n => {
        n.mesh.rotation.y += 0.01;
    });

    renderer.render(scene, camera);
}

// Fetch and render state
async function fetchState() {
    try {
        const res = await fetch("/api/state");
        const data = await res.json();
        renderGraph(data);
    } catch (err) {
        console.error("Failed to load state", err);
    }
}

function renderGraph(state) {
    // Clear old objects
    nodes.forEach(n => scene.remove(n.mesh));
    lines.forEach(l => scene.remove(l));
    nodes = [];
    lines = [];

    const concepts = state.concepts || [];
    const claims = state.claims || [];

    // Concept positioning
    concepts.forEach((c, i) => {
        const angle = (i / concepts.length) * Math.PI * 2;
        const radius = 9;
        const yPos = c.layer === "domain" ? -4 : 4;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const color = c.status === "VERIFIED" ? 0x34d399 : (c.status === "UNRESOLVED" ? 0xf43f5e : 0xfbbf24);
        const geo = new THREE.DodecahedronGeometry(1.2);
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.2,
            metalness: 0.8,
            emissive: color,
            emissiveIntensity: 0.3
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, yPos, z);
        scene.add(mesh);

        nodes.push({ mesh, data: c });
    });

    // Claims positioning on Wiki layer (Y = 12)
    claims.forEach((cl, i) => {
        const angle = (i / Math.max(1, claims.length)) * Math.PI * 2 + 0.5;
        const radius = 7;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x0284c7,
            emissiveIntensity: 0.4
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 12, z);
        scene.add(mesh);

        nodes.push({ mesh, data: { ...cl, layer: "wiki", name: cl.statement, description: cl.statement } });

        // Connect claim to its concept with laser line
        const parentConcept = concepts.find(c => c.id === cl.concept_id);
        if (parentConcept) {
            const pNode = nodes.find(n => n.data.id === parentConcept.id);
            if (pNode) {
                const lineGeo = new THREE.BufferGeometry().setFromPoints([
                    mesh.position,
                    pNode.mesh.position
                ]);
                const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4 });
                const line = new THREE.Line(lineGeo, lineMat);
                scene.add(line);
                lines.push(line);
            }
        }
    });
}

function showNodeModal(data) {
    const modal = document.getElementById("node-modal");
    document.getElementById("modal-layer").textContent = (data.layer || "CONCEPT").toUpperCase();
    document.getElementById("modal-title").textContent = data.name || data.id;
    document.getElementById("modal-desc").textContent = data.description || "No definition available.";

    const evBox = document.getElementById("modal-evidence");
    if (data.evidence && data.evidence.exact_quote) {
        evBox.classList.remove("hidden");
        document.getElementById("modal-quote").textContent = `"${data.evidence.exact_quote}"`;
    } else {
        evBox.classList.add("hidden");
    }

    modal.classList.remove("hidden");
}

function closeModal() {
    document.getElementById("node-modal").classList.add("hidden");
}

function loadSampleText() {
    document.getElementById("input-title").value = "Autonomous Agent Tree Search & MCTS";
    document.getElementById("input-text").value = "Tree search heuristic algorithms combine selective tree exploration with Monte Carlo simulations to guide agent planning. Monte Carlo Tree Search executes rollouts to evaluate state values, but recent agent loops utilize the Interactions API for deliberate reasoning.";
}

async function triggerAssimilate() {
    const title = document.getElementById("input-title").value;
    const text = document.getElementById("input-text").value;
    if (!text.trim()) {
        alert("Please enter technical text to assimilate.");
        return;
    }

    const btn = document.getElementById("btn-assimilate");
    const statusCard = document.getElementById("status-card");
    const statusMsg = document.getElementById("status-msg");

    btn.disabled = true;
    btn.classList.add("opacity-50");
    statusCard.classList.remove("hidden");
    statusMsg.textContent = "Argon Turn 1: Extracting & Mechanical Verifying...";

    try {
        const res = await fetch("/api/assimilate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, text })
        });
        const data = await res.json();
        renderChangeSet(data.changeset);
        fetchState();
    } catch (err) {
        alert("Assimilation error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.classList.remove("opacity-50");
        statusCard.classList.add("hidden");
    }
}

function renderChangeSet(cs) {
    currentChangeSetId = cs.id;
    const container = document.getElementById("diff-content");
    const actions = document.getElementById("diff-actions");
    actions.classList.remove("hidden");

    let html = `
        <div class="p-3 bg-slate-900/90 rounded-xl border border-cyan-800/40">
            <h4 class="font-bold text-slate-200 text-xs flex items-center justify-between">
                <span>${cs.source_title}</span>
                <span class="text-[10px] font-mono text-cyan-400">ID: ${cs.id}</span>
            </h4>
        </div>
    `;

    // Proposed Concepts
    if (cs.proposed_concepts.length > 0) {
        html += `<div class="space-y-1.5"><span class="text-[11px] font-semibold text-slate-400 uppercase">Aligned Concepts</span>`;
        cs.proposed_concepts.forEach(c => {
            const badge = c.status === "VERIFIED" ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-amber-950 text-amber-300 border-amber-800";
            html += `
                <div class="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs">
                    <div class="flex items-center justify-between">
                        <span class="font-semibold text-slate-200">${c.name}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded border ${badge}">${c.status}</span>
                    </div>
                    <p class="text-[11px] text-slate-400 mt-1">${c.description}</p>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Proposed Claims
    if (cs.proposed_claims.length > 0) {
        html += `<div class="space-y-1.5"><span class="text-[11px] font-semibold text-slate-400 uppercase">Proposed Living Wiki Claims</span>`;
        cs.proposed_claims.forEach(cl => {
            html += `
                <div class="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs space-y-1.5">
                    <p class="text-slate-200">${cl.statement}</p>
                    <div class="p-2 rounded bg-slate-950/80 border border-slate-800/80 text-[11px] text-amber-300/90 italic">
                        <i class="fa-solid fa-quote-left text-[9px] mr-1"></i> "${cl.evidence.exact_quote}"
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Unresolved Conflicts
    if (cs.unresolved_conflicts.length > 0) {
        html += `<div class="space-y-1.5"><span class="text-[11px] font-semibold text-rose-400 uppercase"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Contradictions (Unresolved)</span>`;
        cs.unresolved_conflicts.forEach(cl => {
            html += `
                <div class="p-2.5 rounded-lg bg-rose-950/20 border border-rose-800 text-xs space-y-1">
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold uppercase">CONTRADICTION</span>
                    <p class="text-slate-200">${cl.statement}</p>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

async function approveCurrentChangeSet() {
    if (!currentChangeSetId) return;
    try {
        const res = await fetch(`/api/changesets/${currentChangeSetId}/approve`, { method: "POST" });
        const data = await res.json();
        alert("ChangeSet Approved! Concepts and Living Wiki updated.");
        document.getElementById("diff-actions").classList.add("hidden");
        document.getElementById("diff-content").innerHTML = `
            <div class="text-center py-12 text-emerald-400">
                <i class="fa-solid fa-circle-check text-3xl mb-3 block"></i>
                <p>ChangeSet committed successfully.</p>
            </div>
        `;
        fetchState();
    } catch (err) {
        alert("Error approving changeset: " + err.message);
    }
}

async function rejectCurrentChangeSet() {
    if (!currentChangeSetId) return;
    try {
        await fetch(`/api/changesets/${currentChangeSetId}/reject`, { method: "POST" });
        alert("ChangeSet Rejected.");
        document.getElementById("diff-actions").classList.add("hidden");
        document.getElementById("diff-content").innerHTML = `
            <div class="text-center py-12 text-rose-400">
                <i class="fa-solid fa-circle-xmark text-3xl mb-3 block"></i>
                <p>ChangeSet discarded.</p>
            </div>
        `;
    } catch (err) {
        alert("Error rejecting changeset: " + err.message);
    }
}

async function resetState() {
    if (!confirm("Reset knowledge graph to seed domain ontology?")) return;
    try {
        await fetch("/api/reset", { method: "POST" });
        fetchState();
        document.getElementById("diff-content").innerHTML = `
            <div class="text-center py-12 text-slate-500">
                <i class="fa-solid fa-box-archive text-3xl mb-3 block"></i>
                <p>State reset to seed ontology.</p>
            </div>
        `;
        document.getElementById("diff-actions").classList.add("hidden");
    } catch (err) {
        alert("Error resetting: " + err.message);
    }
}

// Initial Bootstrap
window.addEventListener("DOMContentLoaded", () => {
    init3D();
    fetchState();
});
