const API_BASE = (
    window.BACKEND_API_URL ||
    new URLSearchParams(window.location.search).get("api") ||
    ""
).replace(new RegExp("/$"), "");

const URL_EXTRACTOR = new RegExp("https?://\\S+", "i");

const CANONICAL_STAGES = {
    "Idle / Explore": { color: "#38BDF8", bg: "rgba(15, 23, 42, 0.85)", border: "rgba(56, 189, 248, 0.35)", pulse: false, sub: "Constellation orbits active" },
    "Query": { color: "#38BDF8", bg: "rgba(14, 116, 144, 0.28)", border: "#38BDF8", pulse: true, sub: "Searching session constellation" },
    "Ingest": { color: "#60A5FA", bg: "rgba(30, 58, 138, 0.32)", border: "#60A5FA", pulse: true, sub: "Absorbing source into Black Hole" },
    "Align": { color: "#A78BFA", bg: "rgba(76, 29, 149, 0.32)", border: "#A78BFA", pulse: true, sub: "Aligning terms & semantic concepts" },
    "Verify / Repair": { color: "#F59E0B", bg: "rgba(120, 53, 15, 0.32)", border: "#F59E0B", pulse: true, sub: "Checking verbatim quotes" },
    "Review": { color: "#F59E0B", bg: "rgba(120, 53, 15, 0.36)", border: "#F59E0B", pulse: false, sub: "Orbits paused · Review diff" },
    "Apply": { color: "#2DD4BF", bg: "rgba(19, 78, 74, 0.36)", border: "#2DD4BF", pulse: true, sub: "Synthesizing into White Hole Wiki" },
    "Complete": { color: "#2DD4BF", bg: "rgba(19, 78, 74, 0.32)", border: "#2DD4BF", pulse: false, sub: "Assimilated into White Hole Wiki" },
    "Unresolved / Error": { color: "#F43F5E", bg: "rgba(136, 19, 55, 0.35)", border: "#F43F5E", pulse: false, sub: "Existing constellation preserved" }
};

let sceneManager = null;
let currentState = { concepts: [], relations: [], claims: [], pending_changesets: [], all_changesets: [] };
let activeChangeSet = null;
let activePipelineTrace = null;
let currentChangeSetId = null;
let selectedNodeData = null;
let activeTab = "answer";
let isSubmittingPrompt = false;
let isApplyingDiff = false;
let stageTimers = [];

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function safeHttpUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
    }
    return null;
}

function clearStageTimers() {
    while (stageTimers.length > 0) {
        clearTimeout(stageTimers.pop());
    }
}

function setExecutionStage(stageName, customSubtitle) {
    const canonical = CANONICAL_STAGES[stageName] ? stageName : "Idle / Explore";
    const cfg = CANONICAL_STAGES[canonical];

    const badge = document.getElementById("execution-stage-badge");
    const dot = document.getElementById("execution-stage-dot");
    const textEl = document.getElementById("execution-stage-text");
    const subEl = document.getElementById("execution-stage-sub");

    if (badge) {
        badge.style.backgroundColor = cfg.bg;
        badge.style.borderColor = cfg.border;
    }
    if (dot) {
        dot.style.backgroundColor = cfg.color;
        if (cfg.pulse) {
            dot.classList.add("animate-ping");
        } else {
            dot.classList.remove("animate-ping");
        }
    }
    if (textEl) {
        textEl.textContent = canonical;
    }
    if (subEl) {
        subEl.textContent = customSubtitle || cfg.sub;
    }

    if (sceneManager && typeof sceneManager.setExecutionStage === "function") {
        sceneManager.setExecutionStage(canonical);
    }
}

function setActiveSourceIndicator(label) {
    const el = document.getElementById("active-source-indicator");
    if (!el) return;
    if (!label) {
        el.textContent = "";
        el.classList.add("hidden");
    } else {
        const shortLabel = label.length > 34 ? label.slice(0, 33) + "…" : label;
        el.textContent = shortLabel;
        el.classList.remove("hidden");
    }
}

function updateSessionCounters(state) {
    const concepts = state.concepts || [];
    const claims = state.claims || [];
    const termsCount = concepts.filter(c => (c.node_type || "").toUpperCase() === "TERM").length;
    const conceptEntityCount = concepts.length - termsCount;

    const termsEl = document.getElementById("stat-terms-count");
    const conceptsEl = document.getElementById("stat-concepts-count");
    const claimsEl = document.getElementById("stat-claims-count");

    if (termsEl) termsEl.textContent = String(termsCount);
    if (conceptsEl) conceptsEl.textContent = String(conceptEntityCount);
    if (claimsEl) claimsEl.textContent = String(claims.length);

    const sessionConcepts = concepts.filter(c => c.is_seed === false).length;
    const sessionClaims = claims.filter(cl => cl.is_seed === false).length;
    const totalSessionAdded = sessionConcepts + sessionClaims;

    const wikiCounter = document.getElementById("wiki-session-counter");
    if (wikiCounter) {
        if (totalSessionAdded > 0) {
            wikiCounter.textContent = `Seed + ${totalSessionAdded} added`;
            wikiCounter.style.backgroundColor = "rgba(19, 78, 74, 0.36)";
            wikiCounter.style.color = "#2DD4BF";
        } else {
            wikiCounter.textContent = `Seed (${concepts.length + claims.length})`;
        }
    }

    const pendingList = state.pending_changesets || [];
    const effectivePending = activeChangeSet && activeChangeSet.status === "PENDING"
        ? [activeChangeSet]
        : pendingList;

    const pendingBtn = document.getElementById("btn-open-pending-diff");
    const pendingBtnLabel = document.getElementById("pending-diff-btn-label");
    const tabDiffBadge = document.getElementById("tab-diff-badge");

    if (effectivePending.length > 0) {
        if (pendingBtn) pendingBtn.classList.remove("hidden");
        if (pendingBtnLabel) pendingBtnLabel.textContent = `Review Diff (${effectivePending.length})`;
        if (tabDiffBadge) {
            tabDiffBadge.textContent = String(effectivePending.length);
            tabDiffBadge.classList.remove("hidden");
        }
    } else {
        if (pendingBtn) pendingBtn.classList.add("hidden");
        if (tabDiffBadge) tabDiffBadge.classList.add("hidden");
    }
}

function initScene() {
    const container = document.getElementById("canvas-container");
    if (!container) return;

    if (typeof window.IdeaSceneManager === "function") {
        sceneManager = new window.IdeaSceneManager(container, {
            onNodeClick: (nodeData) => handleSceneNodeClick(nodeData),
            onBackgroundClick: () => handleSceneBackgroundClick()
        });
        window.sceneManager = sceneManager;
    }
}

async function fetchState() {
    try {
        const res = await fetch(`${API_BASE}/api/state`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentState = data;

        if (!activeChangeSet && Array.isArray(data.pending_changesets) && data.pending_changesets.length > 0) {
            activeChangeSet = data.pending_changesets[data.pending_changesets.length - 1];
            currentChangeSetId = activeChangeSet.id;
        }

        updateSessionCounters(currentState);
        if (sceneManager && typeof sceneManager.syncGraph === "function") {
            sceneManager.syncGraph(currentState, activeChangeSet);
        }

        const dot = document.getElementById("tier-status-dot");
        if (dot) {
            dot.classList.remove("bg-red-500");
            dot.classList.add("bg-emerald-500");
        }
        return data;
    } catch (err) {
        const dot = document.getElementById("tier-status-dot");
        if (dot) {
            dot.classList.remove("bg-emerald-500");
            dot.classList.add("bg-red-500");
        }
        return null;
    }
}

function showOverlayError(title, message) {
    const card = document.getElementById("overlay-card");
    const banner = document.getElementById("overlay-error-banner");
    const titleEl = document.getElementById("error-banner-title");
    const msgEl = document.getElementById("error-banner-msg");

    if (card) {
        card.classList.remove("hidden");
        card.classList.remove("collapsed");
        syncCollapseButtonState();
    }
    if (titleEl) titleEl.textContent = title || "Execution Error";
    if (msgEl) msgEl.textContent = message || "Unable to complete request. Existing session knowledge remains intact.";
    if (banner) banner.classList.remove("hidden");
}

function hideOverlayError() {
    const banner = document.getElementById("overlay-error-banner");
    if (banner) banner.classList.add("hidden");
}

function switchOverlayTab(tabName) {
    activeTab = tabName;
    const card = document.getElementById("overlay-card");
    if (card) {
        card.classList.remove("hidden");
        card.classList.remove("collapsed");
        syncCollapseButtonState();
    }

    const tabs = ["answer", "node", "diff"];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const view = document.getElementById(`view-${t}`);
        if (btn) {
            if (t === tabName) {
                btn.style.backgroundColor = "rgba(14, 116, 144, 0.28)";
                btn.style.color = "#38BDF8";
            } else {
                btn.style.backgroundColor = "transparent";
                btn.style.color = "#94A3B8";
            }
        }
        if (view) {
            if (t === tabName) {
                view.classList.remove("hidden");
            } else {
                view.classList.add("hidden");
            }
        }
    });

    const nodeActions = document.getElementById("node-card-actions");
    const diffActions = document.getElementById("diff-actions");
    const answerActions = document.getElementById("answer-card-actions");

    if (nodeActions) nodeActions.classList.toggle("hidden", tabName !== "node");
    if (diffActions) diffActions.classList.toggle("hidden", tabName !== "diff" || !activeChangeSet);
    if (answerActions) answerActions.classList.toggle("hidden", tabName !== "answer");
}

function syncCollapseButtonState() {
    const card = document.getElementById("overlay-card");
    const icon = document.getElementById("collapse-overlay-icon");
    const label = document.getElementById("collapse-overlay-label");
    if (!card || !icon || !label) return;

    const isCollapsed = card.classList.contains("collapsed");
    if (isCollapsed) {
        icon.className = "fa-solid fa-chevron-up text-[11px]";
        label.textContent = "Expand";
    } else {
        icon.className = "fa-solid fa-chevron-down text-[11px]";
        label.textContent = "Minimize";
    }
}

function toggleCollapseOverlay() {
    const card = document.getElementById("overlay-card");
    if (!card) return;
    card.classList.toggle("collapsed");
    syncCollapseButtonState();
}

function closeOverlayCard() {
    const card = document.getElementById("overlay-card");
    if (card) {
        card.classList.add("hidden");
        card.classList.remove("collapsed");
    }
    hideOverlayError();
    if (sceneManager) {
        sceneManager.clearTrace();
        if (activeChangeSet && activeChangeSet.status === "PENDING") {
            sceneManager.setExecutionStage("Review");
            sceneManager.setPaused(false);
        } else {
            setExecutionStage("Idle / Explore");
        }
    }
    const tracePill = document.getElementById("active-trace-pill");
    if (tracePill) tracePill.classList.add("hidden");
}

function closeModal() {
    closeOverlayCard();
}

function openPendingDiffCard() {
    if (activeChangeSet) {
        renderChangeSet(activeChangeSet, activePipelineTrace);
        switchOverlayTab("diff");
        setExecutionStage("Review");
    }
}

function enrichNodeFromState(rawNode) {
    if (!rawNode) return null;
    const id = rawNode.id;
    const concepts = currentState.concepts || [];
    const claims = currentState.claims || [];

    const matchedConcept = concepts.find(c => c.id === id);
    if (matchedConcept) {
        return { ...matchedConcept, ...rawNode, evidence: matchedConcept.evidence || rawNode.evidence };
    }

    const matchedClaim = claims.find(cl => cl.id === id);
    if (matchedClaim) {
        return {
            ...matchedClaim,
            ...rawNode,
            node_type: "CLAIM",
            name: matchedClaim.statement,
            description: matchedClaim.statement,
            evidence: matchedClaim.evidence || rawNode.evidence
        };
    }

    if (activeChangeSet) {
        const propConcept = (activeChangeSet.proposed_concepts || []).find(c => c.id === id);
        if (propConcept) return { ...propConcept, ...rawNode, isProposed: true };

        const propClaim = (activeChangeSet.proposed_claims || []).find(cl => cl.id === id);
        if (propClaim) {
            return {
                ...propClaim,
                ...rawNode,
                node_type: "CLAIM",
                name: propClaim.statement,
                description: propClaim.statement,
                isProposed: true
            };
        }

        const conflictClaim = (activeChangeSet.unresolved_conflicts || []).find(cl => cl.id === id);
        if (conflictClaim) {
            return {
                ...conflictClaim,
                ...rawNode,
                node_type: "CLAIM",
                status: "UNRESOLVED",
                name: conflictClaim.statement,
                description: conflictClaim.statement,
                isProposed: true
            };
        }
    }

    return rawNode;
}

function buildVerificationBadges(node) {
    const badges = [];
    const rawList = Array.isArray(node.verification_badges) ? [...node.verification_badges] : [];

    if (node.is_seed && !rawList.includes("Seed knowledge")) {
        rawList.push("Seed knowledge");
    } else if (node.is_seed === false && node.status === "VERIFIED" && !rawList.includes("Added to this session")) {
        rawList.push("Added to this session");
    }

    if (node.evidence && node.evidence.url && !rawList.includes("Source located")) {
        rawList.push("Source located");
    }
    if (node.evidence && node.evidence.mechanical_verified && !rawList.includes("Quote matched")) {
        rawList.push("Quote matched");
    }
    if (node.status === "UNRESOLVED" && !rawList.includes("Needs review")) {
        rawList.push("Needs review");
    }

    const styleMap = {
        "Seed knowledge": { bg: "rgba(15, 23, 42, 0.78)", color: "#94A3B8", border: "rgba(148, 163, 184, 0.18)", icon: "fa-seedling" },
        "Added to this session": { bg: "rgba(19, 78, 74, 0.36)", color: "#2DD4BF", border: "#2DD4BF", icon: "fa-circle-plus" },
        "Source located": { bg: "rgba(14, 116, 144, 0.28)", color: "#38BDF8", border: "#38BDF8", icon: "fa-link" },
        "Quote matched": { bg: "rgba(19, 78, 74, 0.36)", color: "#2DD4BF", border: "#2DD4BF", icon: "fa-check-double" },
        "Model-reviewed": { bg: "rgba(14, 116, 144, 0.28)", color: "#38BDF8", border: "#38BDF8", icon: "fa-microchip" },
        "Needs review": { bg: "rgba(120, 53, 15, 0.32)", color: "#F59E0B", border: "#F59E0B", icon: "fa-triangle-exclamation" },
        "Blocked": { bg: "rgba(136, 19, 55, 0.35)", color: "#F43F5E", border: "#F43F5E", icon: "fa-ban" }
    };

    rawList.forEach(label => {
        const s = styleMap[label] || { bg: "rgba(15, 23, 42, 0.78)", color: "#94A3B8", border: "rgba(148, 163, 184, 0.18)", icon: "fa-tag" };
        badges.push(`
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border inline-flex items-center space-x-1" style="background:${s.bg}; color:${s.color}; border-color:${s.border};">
                <i class="fa-solid ${s.icon} text-[9px]"></i>
                <span>${escapeHtml(label)}</span>
            </span>
        `);
    });

    return badges.join("");
}

function handleSceneNodeClick(rawNode) {
    if (!rawNode) return;
    const node = enrichNodeFromState(rawNode);
    showNodeModal(node);
}

function handleSceneBackgroundClick() {
    if (sceneManager) {
        sceneManager.clearTrace();
    }
    const tracePill = document.getElementById("active-trace-pill");
    if (tracePill) tracePill.classList.add("hidden");
}

function inspectNodeById(nodeId) {
    if (!nodeId) return;
    const raw = { id: nodeId };
    const enriched = enrichNodeFromState(raw);
    if (sceneManager && typeof sceneManager.focusNode === "function") {
        sceneManager.focusNode(nodeId);
    }
    showNodeModal(enriched);
}

function showNodeModal(data) {
    if (!data) return;
    selectedNodeData = data;
    hideOverlayError();
    switchOverlayTab("node");

    if (sceneManager) {
        sceneManager.setPaused(true);
        if (data.id && !String(data.id).startsWith("portal_")) {
            sceneManager.focusNode(data.id);
        }
    }

    const nodeType = (data.node_type || data.layer || "CONCEPT").toUpperCase();
    const status = (data.status || "VERIFIED").toUpperCase();

    const typePalette = {
        TERM: { bg: "rgba(136, 19, 55, 0.35)", color: "#F43F5E", border: "#F43F5E", shape: "◆ TERM" },
        CONCEPT: { bg: "rgba(19, 78, 74, 0.36)", color: "#2DD4BF", border: "#2DD4BF", shape: "● CONCEPT" },
        ENTITY: { bg: "rgba(14, 116, 144, 0.28)", color: "#38BDF8", border: "#38BDF8", shape: "■ ENTITY" },
        CLAIM: { bg: "rgba(14, 116, 144, 0.28)", color: "#38BDF8", border: "#38BDF8", shape: "◎ CLAIM" },
        PORTAL: { bg: "#18212C", color: "rgba(15, 23, 42, 0.78)", border: "#38BDF8", shape: "◉ PORTAL" }
    };
    const tStyle = typePalette[nodeType] || typePalette.CONCEPT;

    const statusPalette = {
        VERIFIED: { bg: "rgba(19, 78, 74, 0.36)", color: "#2DD4BF", border: "#2DD4BF" },
        PROPOSED: { bg: "rgba(120, 53, 15, 0.32)", color: "#F59E0B", border: "#F59E0B" },
        UNRESOLVED: { bg: "rgba(136, 19, 55, 0.35)", color: "#F43F5E", border: "#F43F5E" },
        REJECTED: { bg: "rgba(15, 23, 42, 0.78)", color: "#94A3B8", border: "rgba(148, 163, 184, 0.18)" }
    };
    const sStyle = statusPalette[status] || statusPalette.VERIFIED;

    const badgesRow = document.getElementById("node-badges-row");
    if (badgesRow) {
        let actionBadge = "";
        if (data.action) {
            actionBadge = `<span class="text-[10px] font-mono-code font-semibold px-2 py-0.5 rounded border" style="background:rgba(15, 23, 42, 0.78); color:#F8FAFC; border-color:rgba(148, 163, 184, 0.18);">Action: ${escapeHtml(data.action)}</span>`;
        }
        badgesRow.innerHTML = `
            <span id="modal-layer" class="text-[10px] font-bold px-2 py-0.5 rounded uppercase border" style="background:${tStyle.bg}; color:${tStyle.color}; border-color:${tStyle.border};">${escapeHtml(tStyle.shape)}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase border" style="background:${sStyle.bg}; color:${sStyle.color}; border-color:${sStyle.border};">${escapeHtml(status)}</span>
            ${actionBadge}
            ${buildVerificationBadges(data)}
        `;
    }

    const titleEl = document.getElementById("modal-title");
    if (titleEl) {
        titleEl.textContent = data.name || data.statement || data.id;
    }

    const synRow = document.getElementById("node-synonyms-row");
    if (synRow) {
        if (Array.isArray(data.synonyms) && data.synonyms.length > 0) {
            synRow.classList.remove("hidden");
            synRow.innerHTML = data.synonyms.map(syn => `
                <span class="font-mono-code text-[10px] px-2 py-0.5 rounded border" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18); color:#94A3B8;">alias: ${escapeHtml(syn)}</span>
            `).join("");
        } else {
            synRow.classList.add("hidden");
            synRow.innerHTML = "";
        }
    }

    const descEl = document.getElementById("modal-desc");
    if (descEl) {
        if (data.id === "portal_white_hole") {
            const verifiedClaims = (currentState.claims || []).filter(c => c.status === "VERIFIED");
            descEl.innerHTML = `
                <div class="space-y-2">
                    <p>${escapeHtml(data.description)}</p>
                    <div class="p-2.5 rounded-xl border space-y-1.5" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18);">
                        <span class="text-[11px] font-semibold block" style="color:#2DD4BF;">Synthesized Living Wiki Statements (${verifiedClaims.length})</span>
                        ${verifiedClaims.map(cl => `
                            <div class="p-2 rounded-lg bg-white border flex items-start justify-between gap-2" style="border-color:rgba(148, 163, 184, 0.18);">
                                <span class="text-xs">${escapeHtml(cl.statement)}</span>
                                <button type="button" onclick="inspectNodeById('${escapeHtml(cl.id)}')" class="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">Inspect</button>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `;
        } else if (data.id === "portal_black_hole") {
            const allSources = [];
            (currentState.claims || []).forEach(cl => {
                if (cl.evidence && (cl.evidence.url || cl.evidence.title)) {
                    allSources.push(cl.evidence);
                }
            });
            descEl.innerHTML = `
                <div class="space-y-2">
                    <p>${escapeHtml(data.description)}</p>
                    <div class="p-2.5 rounded-xl border space-y-1" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18);">
                        <span class="text-[11px] font-semibold block" style="color:#38BDF8;">Tracked Source Documents in Session (${allSources.length})</span>
                        ${allSources.slice(0, 5).map(ev => `
                            <div class="text-[11px] flex items-center justify-between py-0.5">
                                <span class="font-medium">${escapeHtml(ev.title || ev.url || "Source")}</span>
                                <span class="font-mono-code text-[10px]" style="color:#94A3B8;">${escapeHtml(ev.section_anchor || "Full text")}</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `;
        } else {
            let text = data.description || data.statement || "No definition available.";
            if (data.alignment_reason) {
                text += ` (Alignment note: ${data.alignment_reason})`;
            }
            descEl.textContent = text;
        }
    }

    const condBox = document.getElementById("node-conditions-box");
    if (condBox) {
        if (data.conditions) {
            condBox.classList.remove("hidden");
            condBox.innerHTML = `<span class="font-semibold"><i class="fa-solid fa-sliders mr-1"></i>Scope &amp; Conditions:</span> ${escapeHtml(data.conditions)}`;
        } else {
            condBox.classList.add("hidden");
            condBox.innerHTML = "";
        }
    }

    const conflictBox = document.getElementById("node-conflict-box");
    if (conflictBox) {
        if (data.conflict_reason || data.semantic_review_note || (Array.isArray(data.conflicts_with) && data.conflicts_with.length > 0)) {
            conflictBox.classList.remove("hidden");
            const reason = data.conflict_reason || data.semantic_review_note || "Requires human review.";
            const targets = Array.isArray(data.conflicts_with) && data.conflicts_with.length > 0
                ? ` (Conflicts with: ${data.conflicts_with.join(", ")})`
                : "";
            conflictBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i><span class="font-semibold">Review / Conflict Notice:</span> ${escapeHtml(reason + targets)}`;
        } else {
            conflictBox.classList.add("hidden");
            conflictBox.innerHTML = "";
        }
    }

    const evBox = document.getElementById("modal-evidence");
    const quoteEl = document.getElementById("modal-quote");
    const anchorEl = document.getElementById("modal-evidence-anchor");
    const linkRow = document.getElementById("modal-source-link-row");

    let effectiveEvidence = data.evidence;
    if (!effectiveEvidence && data.id) {
        const relatedClaim = (currentState.claims || []).find(cl => cl.concept_id === data.id && cl.evidence);
        if (relatedClaim) effectiveEvidence = relatedClaim.evidence;
    }

    if (evBox && quoteEl) {
        if (effectiveEvidence && effectiveEvidence.exact_quote) {
            evBox.classList.remove("hidden");
            quoteEl.textContent = `"${effectiveEvidence.exact_quote}"`;
            if (anchorEl) {
                anchorEl.textContent = effectiveEvidence.section_anchor
                    ? `Section: ${effectiveEvidence.section_anchor}`
                    : "Verbatim span";
            }
            if (linkRow) {
                const validUrl = safeHttpUrl(effectiveEvidence.resolved_url || effectiveEvidence.url);
                const srcTitle = effectiveEvidence.title || effectiveEvidence.url || "Tracked Source";
                const linkHtml = validUrl
                    ? `<a href="${escapeHtml(validUrl)}" target="_blank" rel="noopener noreferrer" class="font-semibold underline hover:text-blue-700" style="color:#38BDF8;"><i class="fa-solid fa-arrow-up-right-from-square text-[10px] mr-1"></i>${escapeHtml(srcTitle)}</a>`
                    : `<span class="font-medium">${escapeHtml(srcTitle)}</span>`;
                const mechBadge = effectiveEvidence.mechanical_verified
                    ? `<span class="font-mono-code text-[10px] px-1.5 py-0.5 rounded" style="background:rgba(19, 78, 74, 0.36); color:#2DD4BF;">Quote matched</span>`
                    : `<span class="font-mono-code text-[10px] px-1.5 py-0.5 rounded" style="background:rgba(120, 53, 15, 0.32); color:#F59E0B;">Unverified span</span>`;
                linkRow.innerHTML = `${linkHtml}${mechBadge}`;
            }
        } else {
            evBox.classList.add("hidden");
        }
    }

    renderConnectedNodesList(data);
}

function renderConnectedNodesList(node) {
    const box = document.getElementById("node-connections-box");
    const list = document.getElementById("node-connections-list");
    if (!box || !list || !node || !node.id) return;

    const connected = [];
    const concepts = currentState.concepts || [];
    const relations = currentState.relations || [];
    const claims = currentState.claims || [];

    if (node.concept_id) {
        const parent = concepts.find(c => c.id === node.concept_id);
        if (parent) {
            connected.push({ id: parent.id, label: parent.name, relation: "grounded_in", type: parent.node_type || "CONCEPT" });
        }
    }

    relations.forEach(r => {
        if (r.source_id === node.id) {
            const tgt = concepts.find(c => c.id === r.target_id);
            connected.push({ id: r.target_id, label: tgt ? tgt.name : r.target_id, relation: r.predicate, type: "CONCEPT" });
        } else if (r.target_id === node.id) {
            const src = concepts.find(c => c.id === r.source_id);
            connected.push({ id: r.source_id, label: src ? src.name : r.source_id, relation: r.predicate, type: "CONCEPT" });
        }
    });

    claims.forEach(cl => {
        if (cl.concept_id === node.id) {
            const shortStmt = cl.statement.length > 42 ? cl.statement.slice(0, 41) + "…" : cl.statement;
            connected.push({ id: cl.id, label: shortStmt, relation: "claim", type: "CLAIM" });
        }
    });

    if (connected.length === 0) {
        box.classList.add("hidden");
        list.innerHTML = "";
        return;
    }

    box.classList.remove("hidden");
    list.innerHTML = connected.map(item => `
        <button type="button" onclick="inspectNodeById('${escapeHtml(item.id)}')" class="px-2.5 py-1 rounded-lg border text-[11px] font-medium hover:border-blue-500 transition flex items-center space-x-1.5" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18); color:#F8FAFC;">
            <span class="font-mono-code text-[10px]" style="color:#38BDF8;">${escapeHtml(item.relation)}</span>
            <span>${escapeHtml(item.label)}</span>
        </button>
    `).join("");
}

function triggerTraceToSource() {
    if (!selectedNodeData || !selectedNodeData.id) return;
    if (sceneManager && typeof sceneManager.traceToSource === "function") {
        sceneManager.traceToSource(selectedNodeData.id);
    }
    const tracePill = document.getElementById("active-trace-pill");
    if (tracePill) {
        tracePill.classList.remove("hidden");
        tracePill.classList.add("flex");
    }
    const evBox = document.getElementById("modal-evidence");
    if (evBox && !evBox.classList.contains("hidden")) {
        evBox.style.borderColor = "#38BDF8";
        evBox.style.boxShadow = "0 0 0 2px rgba(66, 133, 244, 0.2)";
        evBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function clearSceneTrace() {
    if (sceneManager && typeof sceneManager.clearTrace === "function") {
        sceneManager.clearTrace();
    }
    const tracePill = document.getElementById("active-trace-pill");
    if (tracePill) {
        tracePill.classList.add("hidden");
        tracePill.classList.remove("flex");
    }
    const evBox = document.getElementById("modal-evidence");
    if (evBox) {
        evBox.style.borderColor = "rgba(148, 163, 184, 0.18)";
        evBox.style.boxShadow = "none";
    }
}

function resetViewCamera() {
    clearSceneTrace();
    if (sceneManager && typeof sceneManager.resetView === "function") {
        sceneManager.resetView();
    }
}

function extractUrlAndQuestion(rawInput) {
    const trimmed = (rawInput || "").trim();
    const match = trimmed.match(URL_EXTRACTOR);
    if (!match) {
        return { url: null, question: trimmed };
    }
    const extractedUrl = match[0].replace(/[),.;]+$/, "");
    const remainingQuestion = trimmed.replace(match[0], "").trim();
    const effectiveQuestion = remainingQuestion || "What are the core concepts and grounded claims in this source, and how do they relate to our current knowledge?";
    return { url: extractedUrl, question: effectiveQuestion };
}

function updatePromptModeIndicator() {
    const promptEl = document.getElementById("prompt-input");
    const rawTextEl = document.getElementById("input-text");
    const modePill = document.getElementById("prompt-mode-pill");
    const modeIcon = document.getElementById("prompt-mode-icon");
    const modeText = document.getElementById("prompt-mode-text");
    const submitBtn = document.getElementById("btn-prompt-submit");
    const submitLabel = document.getElementById("prompt-submit-label");

    const promptVal = promptEl ? promptEl.value : "";
    const rawTextVal = rawTextEl ? rawTextEl.value.trim() : "";
    const hasUrl = URL_EXTRACTOR.test(promptVal);

    if (hasUrl || rawTextVal.length > 0) {
        if (modePill) {
            modePill.style.backgroundColor = "rgba(19, 78, 74, 0.36)";
            modePill.style.color = "#2DD4BF";
        }
        if (modeIcon) modeIcon.className = "fa-solid fa-satellite-dish text-[10px]";
        if (modeText) modeText.textContent = "Ingest + Ask";
        if (submitBtn) submitBtn.style.backgroundColor = "#2DD4BF";
        if (submitLabel && !isSubmittingPrompt) submitLabel.textContent = "Assimilate";
    } else {
        if (modePill) {
            modePill.style.backgroundColor = "rgba(14, 116, 144, 0.28)";
            modePill.style.color = "#38BDF8";
        }
        if (modeIcon) modeIcon.className = "fa-solid fa-magnifying-glass text-[10px]";
        if (modeText) modeText.textContent = "Ask";
        if (submitBtn) submitBtn.style.backgroundColor = "#38BDF8";
        if (submitLabel && !isSubmittingPrompt) submitLabel.textContent = "Ask";
    }
}

function toggleRawSourceDrawer(forceState) {
    const drawer = document.getElementById("raw-source-drawer");
    if (!drawer) return;
    if (typeof forceState === "boolean") {
        drawer.classList.toggle("hidden", !forceState);
    } else {
        drawer.classList.toggle("hidden");
    }
    updatePromptModeIndicator();
}

function loadSampleText() {
    const titleEl = document.getElementById("input-title");
    const textEl = document.getElementById("input-text");
    const promptEl = document.getElementById("prompt-input");
    const drawer = document.getElementById("raw-source-drawer");

    if (drawer) drawer.classList.remove("hidden");
    if (titleEl) titleEl.value = "vLLM PagedAttention & Prefix Sharing Technical Note";
    if (textEl) {
        textEl.value = "PagedAttention partitions the KV cache of each sequence into non-contiguous memory blocks, reducing internal fragmentation to under 4% and enabling copy-on-write prefix sharing across parallel decoding requests.";
    }
    if (promptEl && !promptEl.value.trim()) {
        promptEl.value = "How does PagedAttention reduce KV cache fragmentation and support prefix sharing?";
    }
    updatePromptModeIndicator();
}

function applyPromptPreset(presetType) {
    const promptEl = document.getElementById("prompt-input");
    const textEl = document.getElementById("input-text");
    const titleEl = document.getElementById("input-title");
    if (!promptEl) return;

    if (presetType === "seed_query") {
        if (textEl) textEl.value = "";
        if (titleEl) titleEl.value = "";
        toggleRawSourceDrawer(false);
        promptEl.value = "How does PagedAttention optimize KV Cache memory allocation and how does Speculative Decoding reuse KV states?";
        updatePromptModeIndicator();
        promptEl.focus();
    } else if (presetType === "arxiv_ingest") {
        if (textEl) textEl.value = "";
        if (titleEl) titleEl.value = "";
        toggleRawSourceDrawer(false);
        promptEl.value = "https://arxiv.org/abs/2309.06180 How does PagedAttention eliminate KV cache memory waste and enable memory sharing?";
        updatePromptModeIndicator();
        promptEl.focus();
    } else if (presetType === "followup_query") {
        if (textEl) textEl.value = "";
        if (titleEl) titleEl.value = "";
        toggleRawSourceDrawer(false);
        promptEl.value = "What concepts and grounded claims were added to our session library, and what verbatim evidence supports them?";
        updatePromptModeIndicator();
        promptEl.focus();
    }
}

function setPromptSubmittingState(submitting, labelText) {
    isSubmittingPrompt = submitting;
    const btn = document.getElementById("btn-prompt-submit");
    const label = document.getElementById("prompt-submit-label");
    const icon = document.getElementById("prompt-submit-icon");
    if (btn) {
        btn.disabled = submitting;
        btn.style.opacity = submitting ? "0.65" : "1";
    }
    if (label) {
        label.textContent = labelText || (submitting ? "Working…" : "Submit");
    }
    if (icon) {
        icon.className = submitting
            ? "fa-solid fa-circle-notch animate-spin text-[11px]"
            : "fa-solid fa-arrow-right text-[11px]";
    }
}

async function handlePromptSubmit(event) {
    if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
    }
    if (isSubmittingPrompt) return;

    const promptEl = document.getElementById("prompt-input");
    const textEl = document.getElementById("input-text");
    const titleEl = document.getElementById("input-title");

    const rawPrompt = promptEl ? promptEl.value.trim() : "";
    const rawSnippet = textEl ? textEl.value.trim() : "";
    const rawTitle = titleEl && titleEl.value.trim() ? titleEl.value.trim() : "Pasted Technical Note";

    if (!rawPrompt && !rawSnippet) {
        if (promptEl) promptEl.focus();
        return;
    }

    const parsed = extractUrlAndQuestion(rawPrompt);
    if (parsed.url || rawSnippet.length > 0) {
        await runSourceAssimilation({
            url: parsed.url,
            text: rawSnippet || null,
            title: rawTitle,
            question: parsed.question
        });
    } else {
        await runKnowledgeQuery(parsed.question);
    }
}

async function runKnowledgeQuery(question) {
    hideOverlayError();
    clearStageTimers();
    setPromptSubmittingState(true, "Querying…");
    setExecutionStage("Query", "Searching approved session library");

    try {
        const res = await fetch(`${API_BASE}/api/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || `Query failed (HTTP ${res.status})`);
        }

        renderQueryAnswer(data);
        switchOverlayTab("answer");

        const highlightIds = [
            ...(data.referenced_concept_ids || []),
            ...(data.referenced_claim_ids || []),
            ...((data.citations || []).map(c => c.node_id).filter(Boolean))
        ];
        if (sceneManager && typeof sceneManager.highlightNodes === "function" && highlightIds.length > 0) {
            sceneManager.highlightNodes(highlightIds);
        }
        setExecutionStage("Query", "Read-only answer · Wiki unchanged");
    } catch (err) {
        setExecutionStage("Unresolved / Error", "Query failed · Library preserved");
        showOverlayError("Query Could Not Complete", err.message);
    } finally {
        setPromptSubmittingState(false);
        updatePromptModeIndicator();
    }
}

function renderQueryAnswer(data) {
    const container = document.getElementById("view-answer");
    if (!container) return;

    const citations = Array.isArray(data.citations) ? data.citations : [];
    const sessionCitationsCount = citations.filter(c => c.is_seed === false).length;
    const seedCitationsCount = citations.filter(c => c.is_seed === true).length;

    let provenanceBanner = "";
    if (sessionCitationsCount > 0) {
        provenanceBanner = `
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background:rgba(19, 78, 74, 0.36); color:#2DD4BF; border-color:#2DD4BF;">
                <i class="fa-solid fa-circle-check mr-1"></i>Uses ${sessionCitationsCount} session-assimilated source(s) + ${seedCitationsCount} seed item(s)
            </span>
        `;
    } else {
        provenanceBanner = `
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background:rgba(15, 23, 42, 0.78); color:#94A3B8; border-color:rgba(148, 163, 184, 0.18);">
                <i class="fa-solid fa-seedling mr-1"></i>Grounded in ${seedCitationsCount || citations.length} seed library item(s)
            </span>
        `;
    }

    let citationsHtml = "";
    if (citations.length > 0) {
        citationsHtml = `
            <div class="pt-2 border-t space-y-1.5" style="border-color:rgba(148, 163, 184, 0.18);">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:#94A3B8;">Grounded Citations &amp; Orbit Nodes (${citations.length})</span>
                    ${provenanceBanner}
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${citations.map(c => {
                        const provBadge = c.is_seed === false
                            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold border" style="background:rgba(19, 78, 74, 0.36); color:#2DD4BF; border-color:#2DD4BF;">Added to this session</span>`
                            : `<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold border" style="background:rgba(15, 23, 42, 0.78); color:#94A3B8; border-color:rgba(148, 163, 184, 0.18);">Seed knowledge</span>`;
                        const quoteSnippet = c.exact_quote
                            ? `<p class="text-[11px] italic truncate mt-1" style="color:#94A3B8;">"${escapeHtml(c.exact_quote)}"</p>`
                            : "";
                        return `
                            <button type="button" onclick="inspectNodeById('${escapeHtml(c.node_id)}')" class="text-left p-2.5 rounded-xl border hover:border-blue-500 transition bg-white space-y-1" style="border-color:rgba(148, 163, 184, 0.18);">
                                <div class="flex items-center justify-between gap-1">
                                    <span class="font-semibold text-xs truncate" style="color:#38BDF8;">${escapeHtml(c.label || c.node_id)}</span>
                                    ${provBadge}
                                </div>
                                ${quoteSnippet}
                            </button>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="space-y-2.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center space-x-1.5">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">Grounded Answer</span>
                    <span class="text-xs font-semibold" style="color:#F8FAFC;">${escapeHtml(data.question || "")}</span>
                </div>
                <span class="font-mono-code text-[10px] px-2 py-0.5 rounded border" style="background:rgba(15, 23, 42, 0.78); color:#94A3B8; border-color:rgba(148, 163, 184, 0.18);">Read-only · Wiki unchanged</span>
            </div>
            <div class="p-3 rounded-xl border text-xs leading-relaxed whitespace-pre-line" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18); color:#F8FAFC;">${escapeHtml(data.answer || "No grounded answer returned.")}</div>
            ${citationsHtml}
        </div>
    `;
}

async function runSourceAssimilation({ url, text, title, question }) {
    hideOverlayError();
    clearStageTimers();
    setPromptSubmittingState(true, "Assimilating…");

    const sourceLabel = url || title || "Source Excerpt";
    setActiveSourceIndicator(sourceLabel);
    setExecutionStage("Ingest", `Reading ${sourceLabel.slice(0, 28)}`);

    stageTimers.push(setTimeout(() => {
        if (isSubmittingPrompt) {
            setExecutionStage("Align", "Mapping terms & canonical concepts");
        }
    }, 650));

    stageTimers.push(setTimeout(() => {
        if (isSubmittingPrompt) {
            setExecutionStage("Verify / Repair", "Checking verbatim quotes & conflicts");
        }
    }, 1400));

    try {
        const payload = { question };
        if (url) payload.url = url;
        if (text) payload.text = text;
        if (title) payload.title = title;

        const res = await fetch(`${API_BASE}/api/assimilate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        clearStageTimers();

        if (!res.ok) {
            throw new Error(data.detail || `Source ingestion failed (HTTP ${res.status})`);
        }

        activeChangeSet = data.changeset;
        activePipelineTrace = data.pipeline_trace || (data.changeset && data.changeset.pipeline_trace) || null;
        currentChangeSetId = activeChangeSet ? activeChangeSet.id : null;

        await fetchState();
        renderChangeSet(activeChangeSet, activePipelineTrace);
        switchOverlayTab("diff");
        setExecutionStage("Review", "Rotation paused · Review & approve changes");
        toggleRawSourceDrawer(false);
    } catch (err) {
        clearStageTimers();
        setExecutionStage("Unresolved / Error", "Source blocked · Existing Wiki intact");
        showOverlayError("Source Ingestion or Verification Blocked", err.message);
    } finally {
        setPromptSubmittingState(false);
        updatePromptModeIndicator();
    }
}

async function triggerAssimilate() {
    const titleEl = document.getElementById("input-title");
    const textEl = document.getElementById("input-text");
    const promptEl = document.getElementById("prompt-input");

    const title = titleEl && titleEl.value.trim() ? titleEl.value.trim() : "Technical Note";
    const text = textEl ? textEl.value.trim() : "";
    const promptVal = promptEl ? promptEl.value.trim() : "";
    const parsed = extractUrlAndQuestion(promptVal);

    await runSourceAssimilation({
        url: parsed.url,
        text: text || null,
        title,
        question: parsed.question
    });
}

function renderPipelineTraceCard(pipelineTrace) {
    if (!pipelineTrace) return "";

    const turn1Id =
        pipelineTrace.turn1_interaction_id ||
        pipelineTrace.interaction_id ||
        pipelineTrace.turn_1_interaction_id ||
        "int_argon_turn1";

    const selfCorrected = Boolean(
        pipelineTrace.self_corrected ||
        pipelineTrace.turn2_triggered ||
        pipelineTrace.turn2_interaction_id ||
        pipelineTrace.turn_2_interaction_id
    );

    const turn2Id =
        pipelineTrace.turn2_interaction_id ||
        pipelineTrace.turn_2_interaction_id ||
        null;

    const badgeStyle = selfCorrected
        ? "background:rgba(120, 53, 15, 0.32); color:#F59E0B; border-color:#F59E0B;"
        : "background:rgba(19, 78, 74, 0.36); color:#2DD4BF; border-color:#2DD4BF;";
    const badgeText = selfCorrected
        ? "SELF-CORRECTED (Turn 2 Repair)"
        : "QUOTE VERIFIED (Turn 1)";

    const rawThoughts = pipelineTrace.thought_summaries || pipelineTrace.thoughts || [];
    const thoughtList = Array.isArray(rawThoughts)
        ? rawThoughts.filter(Boolean)
        : (rawThoughts ? [String(rawThoughts)] : []);

    let thoughtsHtml = "";
    if (thoughtList.length > 0) {
        thoughtsHtml = `
            <details class="pt-1.5 border-t text-[11px]" style="border-color:rgba(148, 163, 184, 0.18);">
                <summary class="cursor-pointer font-semibold select-none" style="color:#38BDF8;">
                    <i class="fa-solid fa-brain mr-1"></i>Argon Reasoning &amp; Verification Trace (${thoughtList.length} step${thoughtList.length > 1 ? "s" : ""})
                </summary>
                <ul class="mt-1.5 space-y-1 list-disc list-inside p-2 rounded-lg border bg-white" style="border-color:rgba(148, 163, 184, 0.18); color:#94A3B8;">
                    ${thoughtList.map(t => `<li class="leading-relaxed">${escapeHtml(t)}</li>`).join("")}
                </ul>
            </details>
        `;
    }

    return `
        <div id="pipeline-trace-card" class="p-3 rounded-xl border space-y-2" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18);">
            <div class="flex items-center justify-between flex-wrap gap-1">
                <span class="text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1.5" style="color:#38BDF8;">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span>Mechanical &amp; Semantic Verification Trace</span>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border" style="${badgeStyle}">
                    ${escapeHtml(badgeText)}
                </span>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[11px]" style="color:#94A3B8;">
                <span class="font-mono-code px-2 py-0.5 rounded border bg-white" style="border-color:rgba(148, 163, 184, 0.18);">Turn 1: ${escapeHtml(turn1Id)}</span>
                ${turn2Id ? `<span class="font-mono-code px-2 py-0.5 rounded border" style="background:rgba(120, 53, 15, 0.32); border-color:#F59E0B; color:#F59E0B;">Turn 2 (previous_interaction_id): ${escapeHtml(turn2Id)}</span>` : ""}
            </div>
            ${thoughtsHtml}
        </div>
    `;
}

function renderChangeSet(cs, pipelineTrace = null) {
    if (!cs) return;
    currentChangeSetId = cs.id;
    activeChangeSet = cs;
    if (pipelineTrace) activePipelineTrace = pipelineTrace;

    const container = document.getElementById("diff-content");
    const actions = document.getElementById("diff-actions");
    if (!container) return;
    if (actions) actions.classList.remove("hidden");

    const effectiveTrace = pipelineTrace || cs.pipeline_trace || activePipelineTrace || null;
    const validSourceUrl = safeHttpUrl(cs.resolved_url || cs.source_url);
    const sourceLinkHtml = validSourceUrl
        ? `<a href="${escapeHtml(validSourceUrl)}" target="_blank" rel="noopener noreferrer" class="underline font-mono-code text-[11px]" style="color:#38BDF8;">${escapeHtml(validSourceUrl)}</a>`
        : `<span class="font-mono-code text-[11px]" style="color:#94A3B8;">${escapeHtml(cs.source_url || "Direct text excerpt")}</span>`;

    let html = "";

    if (cs.answer || cs.question) {
        html += `
            <div class="p-3 rounded-xl border space-y-1.5" style="background:rgba(14, 116, 144, 0.28); border-color:#38BDF8;">
                <div class="flex items-center justify-between flex-wrap gap-1">
                    <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white border" style="color:#38BDF8; border-color:#38BDF8;">
                        <i class="fa-solid fa-comment-dots mr-1"></i>Answer from Source
                    </span>
                    <span class="text-[10px] font-semibold" style="color:#38BDF8;">Candidate changes below await your approval</span>
                </div>
                ${cs.question ? `<p class="text-xs font-semibold" style="color:#F8FAFC;">Q: ${escapeHtml(cs.question)}</p>` : ""}
                <p class="text-xs leading-relaxed" style="color:#F8FAFC;">${escapeHtml(cs.answer || "See extracted claims and concepts below.")}</p>
            </div>
        `;
    }

    html += `
        <div class="p-3 rounded-xl border bg-white space-y-1" style="border-color:rgba(148, 163, 184, 0.18);">
            <div class="flex items-center justify-between flex-wrap gap-1">
                <div class="flex items-center space-x-2">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">Source located</span>
                    <h4 class="font-bold text-xs" style="color:#F8FAFC;">${escapeHtml(cs.source_title || "Ingested Source")}</h4>
                </div>
                <span class="font-mono-code text-[10px]" style="color:#94A3B8;">ChangeSet: ${escapeHtml(cs.id)}</span>
            </div>
            <div>${sourceLinkHtml}</div>
            ${cs.rationale ? `<p class="text-[11px] pt-1" style="color:#94A3B8;"><strong style="color:#F8FAFC;">Semantic Alignment Rationale:</strong> ${escapeHtml(cs.rationale)}</p>` : ""}
        </div>
    `;

    html += renderPipelineTraceCard(effectiveTrace);

    const proposedConcepts = cs.proposed_concepts || [];
    if (proposedConcepts.length > 0) {
        html += `
            <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase tracking-wider" style="color:#F8FAFC;">1. Semantic Alignment: Terms &amp; Concepts (${proposedConcepts.length})</span>
                    <span class="text-[10px]" style="color:#94A3B8;">Check items to merge/add</span>
                </div>
        `;
        proposedConcepts.forEach(c => {
            const action = (c.action || (c.status === "UNRESOLVED" ? "UNRESOLVED" : "PROPOSE")).toUpperCase();
            const isUnresolved = c.status === "UNRESOLVED" || action === "UNRESOLVED";
            const actionStyle = action === "MATCH"
                ? "background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;"
                : (isUnresolved ? "background:rgba(136, 19, 55, 0.35); color:#F43F5E; border-color:#F43F5E;" : "background:rgba(19, 78, 74, 0.36); color:#2DD4BF; border-color:#2DD4BF;");
            const actionLabel = action === "MATCH"
                ? "MATCH · Canonical Alias"
                : (isUnresolved ? "UNRESOLVED · Held Back" : `PROPOSE · New ${c.node_type || "CONCEPT"}`);
            const aliases = Array.isArray(c.synonyms) && c.synonyms.length > 0
                ? `<div class="text-[10px] font-mono-code mt-0.5" style="color:#94A3B8;">Aliases: ${escapeHtml(c.synonyms.join(", "))}</div>`
                : "";

            html += `
                <label class="p-2.5 rounded-xl border bg-white flex items-start space-x-2.5 cursor-pointer hover:border-blue-400 transition" style="border-color:rgba(148, 163, 184, 0.18);">
                    <input type="checkbox" class="diff-concept-cb mt-1 w-3.5 h-3.5 rounded" data-id="${escapeHtml(c.id)}" ${isUnresolved ? "disabled" : "checked"} onchange="updateDiffSelectionSummary()">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between flex-wrap gap-1">
                            <span class="font-semibold text-xs" style="color:#F8FAFC;">${escapeHtml(c.name)}</span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded border" style="${actionStyle}">${escapeHtml(actionLabel)}</span>
                        </div>
                        ${aliases}
                        <p class="text-[11px] mt-1 leading-relaxed" style="color:#94A3B8;">${escapeHtml(c.description || "")}</p>
                        ${c.alignment_reason ? `<p class="text-[10px] mt-0.5 italic" style="color:#38BDF8;">${escapeHtml(c.alignment_reason)}</p>` : ""}
                    </div>
                </label>
            `;
        });
        html += `</div>`;
    }

    const proposedRelations = cs.proposed_relations || [];
    if (proposedRelations.length > 0) {
        html += `
            <div class="space-y-1.5">
                <span class="text-[11px] font-bold uppercase tracking-wider block" style="color:#F8FAFC;">2. Proposed Semantic Relations (${proposedRelations.length})</span>
        `;
        proposedRelations.forEach(r => {
            html += `
                <label class="p-2.5 rounded-xl border bg-white flex items-start space-x-2.5 cursor-pointer hover:border-blue-400 transition" style="border-color:rgba(148, 163, 184, 0.18);">
                    <input type="checkbox" class="diff-relation-cb mt-1 w-3.5 h-3.5 rounded" data-id="${escapeHtml(r.id)}" checked onchange="updateDiffSelectionSummary()">
                    <div class="flex-1 text-xs">
                        <div class="font-mono-code text-[11px] flex items-center flex-wrap gap-1">
                            <span class="font-semibold" style="color:#F8FAFC;">${escapeHtml(r.source_id)}</span>
                            <span class="px-1.5 py-0.5 rounded border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">—[ ${escapeHtml(r.predicate)} ]→</span>
                            <span class="font-semibold" style="color:#F8FAFC;">${escapeHtml(r.target_id)}</span>
                        </div>
                        ${r.description ? `<p class="text-[11px] mt-1" style="color:#94A3B8;">${escapeHtml(r.description)}</p>` : ""}
                    </div>
                </label>
            `;
        });
        html += `</div>`;
    }

    const proposedClaims = cs.proposed_claims || [];
    if (proposedClaims.length > 0) {
        html += `
            <div class="space-y-1.5">
                <span class="text-[11px] font-bold uppercase tracking-wider block" style="color:#F8FAFC;">3. Verified Grounded Claims (${proposedClaims.length})</span>
        `;
        proposedClaims.forEach(cl => {
            const quoteText = cl.evidence && cl.evidence.exact_quote ? cl.evidence.exact_quote : "";
            const anchorText = cl.evidence && cl.evidence.section_anchor ? cl.evidence.section_anchor : "Source body";
            html += `
                <label class="p-3 rounded-xl border bg-white flex items-start space-x-2.5 cursor-pointer hover:border-blue-400 transition" style="border-color:rgba(148, 163, 184, 0.18);">
                    <input type="checkbox" class="diff-claim-cb mt-1 w-3.5 h-3.5 rounded" data-id="${escapeHtml(cl.id)}" checked onchange="updateDiffSelectionSummary()">
                    <div class="flex-1 space-y-1.5">
                        <div class="flex items-center justify-between flex-wrap gap-1">
                            <span class="font-mono-code text-[10px] px-1.5 py-0.5 rounded border" style="background:rgba(15, 23, 42, 0.78); color:#94A3B8; border-color:rgba(148, 163, 184, 0.18);">Concept: ${escapeHtml(cl.concept_id)}</span>
                            <div class="flex items-center gap-1 flex-wrap">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">Source located</span>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background:rgba(19, 78, 74, 0.36); color:#2DD4BF; border-color:#2DD4BF;">Quote matched</span>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background:rgba(14, 116, 144, 0.28); color:#38BDF8; border-color:#38BDF8;">Model-reviewed</span>
                            </div>
                        </div>
                        <p class="text-xs font-medium leading-relaxed" style="color:#F8FAFC;">${escapeHtml(cl.statement)}</p>
                        ${cl.conditions ? `<p class="text-[11px] px-2 py-1 rounded border" style="background:rgba(120, 53, 15, 0.32); border-color:#F59E0B; color:#F59E0B;"><strong>Conditions / Scope:</strong> ${escapeHtml(cl.conditions)}</p>` : ""}
                        ${quoteText ? `
                            <div class="p-2 rounded-lg border text-[11px] italic" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18); color:#94A3B8;">
                                <i class="fa-solid fa-quote-left text-[9px] mr-1" style="color:#38BDF8;"></i>"${escapeHtml(quoteText)}"
                                <span class="not-italic font-mono-code text-[10px] ml-1" style="color:#38BDF8;">[${escapeHtml(anchorText)}]</span>
                            </div>
                        ` : ""}
                    </div>
                </label>
            `;
        });
        html += `</div>`;
    }

    const conflicts = cs.unresolved_conflicts || [];
    const blocked = cs.blocked_claims || [];
    if (conflicts.length > 0 || blocked.length > 0) {
        html += `
            <div class="space-y-1.5 pt-1">
                <span class="text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1.5" style="color:#F43F5E;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Held Back — Conflicts &amp; Unverified Claims (${conflicts.length + blocked.length})</span>
                </span>
        `;
        conflicts.forEach(cl => {
            const reason = cl.conflict_reason || cl.semantic_review_note || "Contradicts existing verified session claim; held back from automatic overwrite.";
            const conflictTargets = Array.isArray(cl.conflicts_with) && cl.conflicts_with.length > 0
                ? `Conflicts with: ${cl.conflicts_with.join(", ")}`
                : "Unresolved semantic conflict";
            html += `
                <div class="p-3 rounded-xl border flex items-start space-x-2.5 opacity-95" style="background:rgba(136, 19, 55, 0.35); border-color:#F43F5E;">
                    <input type="checkbox" disabled class="mt-1 w-3.5 h-3.5 rounded cursor-not-allowed">
                    <div class="flex-1 space-y-1">
                        <div class="flex items-center justify-between flex-wrap gap-1">
                            <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white border" style="color:#F43F5E; border-color:#F43F5E;">
                                <i class="fa-solid fa-triangle-exclamation mr-1"></i>Needs review · Held Back
                            </span>
                            <span class="font-mono-code text-[10px]" style="color:#F43F5E;">${escapeHtml(conflictTargets)}</span>
                        </div>
                        <p class="text-xs font-medium" style="color:#F8FAFC;">${escapeHtml(cl.statement)}</p>
                        <p class="text-[11px]" style="color:#F43F5E;">${escapeHtml(reason)}</p>
                    </div>
                </div>
            `;
        });

        blocked.forEach(cl => {
            const reason = cl.conflict_reason || cl.semantic_review_note || "Mechanical quote check failed: exact verbatim quote not found in source text.";
            html += `
                <div class="p-3 rounded-xl border flex items-start space-x-2.5 opacity-95" style="background:rgba(136, 19, 55, 0.35); border-color:#F43F5E;">
                    <input type="checkbox" disabled class="mt-1 w-3.5 h-3.5 rounded cursor-not-allowed">
                    <div class="flex-1 space-y-1">
                        <div class="flex items-center justify-between flex-wrap gap-1">
                            <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white border" style="color:#F43F5E; border-color:#F43F5E;">
                                <i class="fa-solid fa-ban mr-1"></i>Blocked · Quote Mismatch
                            </span>
                        </div>
                        <p class="text-xs font-medium" style="color:#F8FAFC;">${escapeHtml(cl.statement)}</p>
                        <p class="text-[11px]" style="color:#F43F5E;">${escapeHtml(reason)}</p>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
    updateDiffSelectionSummary();
}

function getSelectedDiffIds() {
    const conceptIds = Array.from(document.querySelectorAll(".diff-concept-cb:checked"))
        .map(el => el.getAttribute("data-id"))
        .filter(Boolean);
    const relationIds = Array.from(document.querySelectorAll(".diff-relation-cb:checked"))
        .map(el => el.getAttribute("data-id"))
        .filter(Boolean);
    const claimIds = Array.from(document.querySelectorAll(".diff-claim-cb:checked"))
        .map(el => el.getAttribute("data-id"))
        .filter(Boolean);
    return { conceptIds, relationIds, claimIds };
}

function updateDiffSelectionSummary() {
    const { conceptIds, relationIds, claimIds } = getSelectedDiffIds();
    const total = conceptIds.length + relationIds.length + claimIds.length;
    const summaryEl = document.getElementById("diff-selection-summary");
    const approveBtn = document.getElementById("btn-approve-diff");

    if (summaryEl) {
        summaryEl.textContent = `${conceptIds.length} concept(s), ${relationIds.length} relation(s), ${claimIds.length} claim(s) selected`;
    }
    if (approveBtn && !isApplyingDiff) {
        approveBtn.disabled = total === 0;
        approveBtn.style.opacity = total === 0 ? "0.5" : "1";
    }
}

async function approveCurrentChangeSet() {
    if (!currentChangeSetId || isApplyingDiff) return;
    const { conceptIds, relationIds, claimIds } = getSelectedDiffIds();

    isApplyingDiff = true;
    const approveBtn = document.getElementById("btn-approve-diff");
    const rejectBtn = document.getElementById("btn-reject-diff");
    if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.style.opacity = "0.6";
    }
    if (rejectBtn) rejectBtn.disabled = true;

    setExecutionStage("Apply", "Committing approved knowledge to White Hole Wiki");

    try {
        const res = await fetch(`${API_BASE}/api/changesets/${currentChangeSetId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                concept_ids: conceptIds,
                relation_ids: relationIds,
                claim_ids: claimIds
            })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || `Approval failed (HTTP ${res.status})`);
        }

        const approvedNodeIds = [...conceptIds, ...claimIds];
        if (sceneManager && typeof sceneManager.triggerAbsorptionAnimation === "function") {
            sceneManager.triggerAbsorptionAnimation(approvedNodeIds);
        }

        activeChangeSet = null;
        currentChangeSetId = null;
        await fetchState();

        setExecutionStage("Complete", "Added to session library · Ready for follow-up questions");

        const actions = document.getElementById("diff-actions");
        if (actions) actions.classList.add("hidden");

        const container = document.getElementById("diff-content");
        if (container) {
            container.innerHTML = `
                <div class="p-4 rounded-xl border text-center space-y-2.5" style="background:rgba(19, 78, 74, 0.36); border-color:#2DD4BF; color:#2DD4BF;">
                    <div class="flex items-center justify-center space-x-2 font-bold text-sm">
                        <i class="fa-solid fa-circle-check text-base"></i>
                        <span>Added to this session's Living Wiki</span>
                    </div>
                    <p class="text-xs" style="color:#F8FAFC;">
                        Committed <strong>${conceptIds.length}</strong> concept(s), <strong>${relationIds.length}</strong> relation(s), and <strong>${claimIds.length}</strong> verified claim(s) into the Right White Hole. Unresolved or unchecked items were not promoted.
                    </p>
                    <div class="pt-1 flex items-center justify-center gap-2">
                        <button type="button" onclick="applyPromptPreset('followup_query')" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm" style="background:#38BDF8;">
                            <i class="fa-solid fa-magnifying-glass mr-1"></i>Ask a follow-up question in prompt
                        </button>
                    </div>
                </div>
            `;
        }
    } catch (err) {
        setExecutionStage("Unresolved / Error", "Approval error");
        showOverlayError("Could Not Apply ChangeSet", err.message);
    } finally {
        isApplyingDiff = false;
        if (approveBtn) {
            approveBtn.disabled = false;
            approveBtn.style.opacity = "1";
        }
        if (rejectBtn) rejectBtn.disabled = false;
    }
}

async function rejectCurrentChangeSet() {
    if (!currentChangeSetId || isApplyingDiff) return;
    isApplyingDiff = true;
    try {
        const res = await fetch(`${API_BASE}/api/changesets/${currentChangeSetId}/reject`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        activeChangeSet = null;
        currentChangeSetId = null;
        setActiveSourceIndicator(null);
        await fetchState();
        setExecutionStage("Idle / Explore", "Changes discarded · Existing Wiki preserved");

        const actions = document.getElementById("diff-actions");
        if (actions) actions.classList.add("hidden");

        const container = document.getElementById("diff-content");
        if (container) {
            container.innerHTML = `
                <div class="p-4 rounded-xl border text-center space-y-1.5" style="background:rgba(15, 23, 42, 0.78); border-color:rgba(148, 163, 184, 0.18); color:#94A3B8;">
                    <div class="font-semibold text-xs" style="color:#F8FAFC;">
                        <i class="fa-solid fa-ban mr-1" style="color:#F43F5E;"></i>Candidate ChangeSet Rejected
                    </div>
                    <p class="text-xs">No candidate claims or concepts were added. Your existing session Wiki remains unchanged.</p>
                </div>
            `;
        }
    } catch (err) {
        showOverlayError("Reject Action Failed", err.message);
    } finally {
        isApplyingDiff = false;
    }
}

async function resetState() {
    clearStageTimers();
    try {
        const res = await fetch(`${API_BASE}/api/reset`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        activeChangeSet = null;
        activePipelineTrace = null;
        currentChangeSetId = null;
        selectedNodeData = null;
        setActiveSourceIndicator(null);
        closeOverlayCard();
        await fetchState();
        resetViewCamera();
        setExecutionStage("Idle / Explore", "Session reset to seed library");
    } catch (err) {
        showOverlayError("Session Reset Error", err.message);
    }
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        const card = document.getElementById("overlay-card");
        if (card && !card.classList.contains("hidden")) {
            closeOverlayCard();
        }
    }
});

window.addEventListener("DOMContentLoaded", () => {
    const label = document.getElementById("api-target-label");
    if (label) {
        label.textContent = "gemini-4-argon";
    }
    initScene();
    updatePromptModeIndicator();
    fetchState();
});

function setConstellationLens(lens) {
    if (sceneManager && typeof sceneManager.setLayerFilter === 'function') {
        sceneManager.setLayerFilter(lens);
    }
    const btns = document.querySelectorAll('.lens-filter-btn');
    btns.forEach(btn => {
        btn.style.textDecoration = 'none';
        btn.style.fontWeight = 'normal';
    });
    if(event && event.currentTarget) {
        event.currentTarget.style.textDecoration = 'underline';
        event.currentTarget.style.fontWeight = 'bold';
    }
}
