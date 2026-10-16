# DESIGN.md — Visual, Spatial & Interaction Specification

> **Document Governance**: This document defines the **UI layout, 3D spatial aesthetics, color system, and interaction states** for **Project IDEA**. Product scope, pipeline stages, and Acceptance Criteria (`AC-01`–`AC-10`) live in [`PRD.md`](file:///Users/beomsu/Documents/antigravity/deepmind%20hackathon/PRD.md). Repository boundaries and multi-agent operating rules live in [`AGENTS.md`](file:///Users/beomsu/Documents/antigravity/deepmind%20hackathon/AGENTS.md).

---

## 1. Aesthetic Direction & References

### 1.1 Persona: Dark 3D Knowledge Constellation & 4-Layer Arena3D Space
Project IDEA adopts a **Dark 3D Knowledge Constellation** aesthetic combined with **Arena3D stratified parallel planes**, visualizing knowledge assimilation as a living cosmic observatory. Semantic structures, citations, and pending proposals shine with restrained **Cyan, Blue, Violet, and Teal** luminescence across a wide, uncluttered 3D canvas.

* **Primary References**:
  * **CareerHackerAlex Second Brain (`https://www.careerhackeralex.com/memory`)**: Deep dark cosmic void, luminous star-like nodes with soft radial halos, ultra-thin translucent constellation filaments, floating high-contrast node labels, fluid 3D orbit/zoom navigation, interactive lens filtering, and click-to-read node inspection in a dedicated right sidepanel.
  * **Arena3D Web (`https://www.arena3d.org/`)**: **4 stratified parallel tilted 3D graph planes** (`01 · JARGON` → `02 · CONCEPTS` → `03 · ENTITIES` → `04 · WIKI`) with inter-layer relational filaments and per-plane header badges.
* **Additional Spatial & Interaction References**:
  * **Pure Particle Portals**: Left-side Black Hole (`x = -26.5`) and Right-side White Hole (`x = +26.5`) rendered purely as slow, organic inward/outward particle streams with soft radial glow (no opaque planet spheres or solid Saturn rings).
  * **3D Force Graph — Click-to-Focus (`https://vasturiano.github.io/3d-force-graph/example/click-to-focus/`)**: Smooth camera interpolation (`lerp`) toward a clicked node and its immediate neighborhood while pausing/slowing ambient rotation.
  * **3D Force Graph — Emit Particles (`https://vasturiano.github.io/3d-force-graph/example/emit-particles/`)**: Single, slow, deliberate light pulse per edge (`1 pulse per link`) traveling along provenance filaments (`Black Hole → 4-Layer Arena3D Space → White Hole`).

### 1.2 Color Palette (Deep Space + Restrained Cyan / Blue / Violet / Teal Luminescence)
Visual hierarchy is established through deep navy-black depth, translucent dark glassmorphism, and restrained luminous accents:

| Token Role | Hex / Value | Usage |
| :--- | :--- | :--- |
| **Deep Cosmic Void (Canvas Base)** | `#05070F` (`0x05070f`) | Primary WebGL scene background and `:root` surface (`color-scheme: dark`) |
| **Nebula Vignette Gradient** | `#0C1428` → `#05070F` | Subtle radial depth backdrop behind the 3D constellation |
| **Dark Glass HUD Surface** | `rgba(9, 14, 28, 0.84)` | Top header bar, Right Sidepanel drawer, and bottom Prompt Composer (`backdrop-filter: blur(22px)`) |
| **Elevated Card / Sub-panel** | `rgba(15, 23, 42, 0.78)` | Evidence blocks, diff item rows, citation cards, and provenance badges |
| **Subtle Structural Border** | `rgba(148, 163, 184, 0.18)` | Hairline borders for HUD panels, pills, and dividers |
| **Active Luminous Border** | `rgba(56, 189, 248, 0.36)` | Focused prompt dock, active lens pill, and selected node card border |
| **Primary Typography** | `#F8FAFC` (Slate 50) | Headings, node titles, wiki synthesis prose, and prompt input |
| **Secondary Typography** | `#94A3B8` (Slate 400) | Descriptions, relation labels, source metadata, and helper copy |
| **Layer 01 — Jargon (`TERM`)** | `#38BDF8` (Electric Cyan) | Plane 1 (`x = -12.0`), domain acronyms/jargon octahedron nodes, and inflow accents |
| **Layer 02 — Concepts (`CONCEPT`)** | `#60A5FA` (Celestial Blue) | Plane 2 (`x = -4.0`), canonical Concept icosahedron nodes and primary edges |
| **Layer 03 — Entities (`ENTITY`)** | `#A78BFA` (Luminous Violet) | Plane 3 (`x = +4.0`), named Entity/System/Architecture dodecahedron nodes |
| **Layer 04 — Wiki (`CLAIM` / `WIKI`)** | `#2DD4BF` (Synthesized Teal) | Plane 4 (`x = +12.0`), grounded Claim & synthesized Living Wiki torus nodes |
| **White Hole / Approved Wiki** | `#2DD4BF` / `#38BDF8` (Cyan-Teal) | Right-side White Hole (`x = +26.5`) pure outward particle stream and `Verified` badges |
| **Pending / Proposed ChangeSet** | `#F59E0B` (Amber Pulse) | Unapproved candidate nodes/edges, wireframe shells, and `Proposed` diff state |
| **Conflict / Blocked Gate** | `#F43F5E` (Crimson Rose) | `UNRESOLVED` semantic conflicts and mechanically `Blocked` (`REJECTED`) claims |

### 1.3 Typography & Rich Markdown Viewer
* **Sans-Serif UI & Prose**: `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
* **Technical Metadata, IDs & Verbatim Quotes**: `'JetBrains Mono', monospace`
* **Rich Markdown Rendering (`renderMarkdownHtml`)**: Grounded answers (`#view-answer`), node descriptions & Living Wiki synthesis (`#modal-desc`, `#node-wiki-synthesis-box`), verbatim quotes (`#modal-quote`), and Knowledge Diff summaries (`#view-diff`) render full structured Markdown (`h1`–`h4`, bulleted/numbered lists, blockquotes, inline code badges, fenced code blocks, bold/italic emphasis, safe external links, and horizontal dividers) inside `.idea-markdown-prose`.

---

## 2. Core Spatial Architecture (Wide Continuous WebGL Scene)

The entire viewport (`100vw × 100vh`, `overflow: hidden`) is a **single continuous Three.js WebGL 3D scene** with a wide-angle framing (`fov = 50`, `camera.position = (0, 5.5, 35.5)`, `controls.target = (0, -0.5, 0)`):

```
[ Left: BLACK HOLE (x = -26.5) ] ──► [ Layer 01: JARGON (-12.0) | Layer 02: CONCEPTS (-4.0) | Layer 03: ENTITIES (+4.0) | Layer 04: WIKI (+12.0) ] ──► [ Right: WHITE HOLE (x = +26.5) ]
  Pure Inward Particle Stream          4 Parallel Tilted Arena3D Planes (14.4 × 15.4, rotY = -0.34, rotX = 0.11) + Slow Deliberate Motion              Pure Outward Particle Stream
```

1. **Left — Black Hole (`x = -26.5, y = 0, z = 0`)**:
   * **Visuals**: Pure inward-spiraling particle vortex (`450–500` soft radial-glow particles, no solid planet core or opaque rings) with slow, calm orbital drift (`spdMult = 0.45` idle).
   * **Prompt Preprocessing Scatter (`setPreprocessedTokens`)**: As the user types or submits a prompt/URL, extracted domain tokens (`[JARGON]`, `[CONCEPT]`, `[ENTITY]`, `[WIKI]`) materialize as floating 3D badges near `x = -33`, drift slowly into the Black Hole (`x = -26.5`), and disperse toward their target layer plane (`-12.0`, `-4.0`, `+4.0`, `+12.0`).
   * **Interactive Portal**: Clicking the Black Hole portal inspects tracked source documents and raw anchor metadata in the Right Sidepanel.

2. **Center — 4-Layer Arena3D Knowledge Space (`x = -12.0, -4.0, +4.0, +12.0`)**:
   * **4 Stratified Parallel Tilted Planes (`14.4 × 15.4`, `rotY = -0.34`, `rotX = 0.11`)**:
     * **Layer 01 (`x = -12.0`, Cyan `#38BDF8`)**: **`01 · JARGON` (`TERM`)** — Domain acronyms and technical vocabulary rendered as luminous octahedra.
     * **Layer 02 (`x = -4.0`, Blue `#60A5FA`)**: **`02 · CONCEPTS` (`CONCEPT`)** — Canonical semantic concepts rendered as icosahedra.
     * **Layer 03 (`x = +4.0`, Violet `#A78BFA`)**: **`03 · ENTITIES` (`ENTITY`)** — Named architectures, frameworks, models, and systems rendered as dodecahedra.
     * **Layer 04 (`x = +12.0`, Teal `#2DD4BF`)**: **`04 · WIKI` (`CLAIM` / `WIKI`)** — Grounded claims and synthesized Living Wiki statements rendered as torus nodes.
   * **Slow, Calm Motion & Single-Pulse Edges**:
     * Orbital angular velocities (`0.00065`, `-0.00052`, `0.00048`, `-0.00058`) and intra-plane force relaxation are intentionally slow and calm so users can read labels effortlessly.
     * Each inter-layer or intra-layer filament carries **1 slow light pulse per edge**, accelerating only when traced or highlighted.

3. **Right — White Hole (`x = +26.5, y = 0, z = 0`)**:
   * **Visuals**: Pure outward-streaming particle fountain (`450–500` soft radial-glow cyan/teal particles, no solid sphere or torus rings).
   * **Role**: Exit portal where approved knowledge crystallizes into the session's **Living Wiki**, connected to Layer 04 (`04 · WIKI`) via subtle teal synthesis threads.

---

## 3. HUD Layout, 4-Layer Lens Header & Right Sidepanel Ergonomics

* **Top Telemetry, Pipeline Stepper & 4-Layer Lens Bar (`height: 48px`)**:
  * **Left**: Project IDEA emblem + title + interactive **4-Layer Constellation Lens Pills** (`All Layers`, `01 Jargon` `#stat-terms-count`, `02 Concepts` `#stat-concepts-count`, `03 Entities` `#stat-entities-count`, `04 Wiki` `#stat-claims-count`, `Pending`).
  * **Right**: Live **Pipeline Stage Stepper** (`Ingest → Align → Verify → Wiki | Query`), **Execution Stage Badge** (`#execution-stage-badge`), `Review Diff` shortcut (`#btn-open-pending-diff`), `Reset view`, and `Reset session`.
* **Generous Full-Height Right Sidepanel (`#overlay-card`)**:
  * Docked on the right side of the viewport (`position: fixed; top: 58px; right: 16px; bottom: 16px; width: min(520px, 38vw); min-width: 390px; max-height: calc(100vh - 74px); z-index: 35;`).
  * When opened (`body.sidepanel-open`), `sceneManager.setSidepanelOpen(true)` smoothly shifts the 3D camera target (`defaultTargetPos.x = 5.5`) and re-centers `#prompt-dock` in the left 62% canvas area so the entire 4-layer constellation and both portals remain unobstructed.
  * Contains three unified tabs with rich Markdown rendering (`renderMarkdownHtml`):
    1. **Answer (`#view-answer`)**: Structured Markdown synthesis, provenance banner, and clickable citation cards.
    2. **Knowledge Card (`#view-node`)**: Layer/status badges, synonyms, Markdown description, Living Wiki synthesis box (`#node-wiki-synthesis-box`), verbatim source quote (`#modal-quote`), and clickable 1-hop orbital neighbors.
    3. **Knowledge Diff (`#view-diff`)**: Argon verification trace (`#pipeline-trace-card`), candidate items organized by the **4 Arena3D Layers** (`01 · JARGON`, `02 · CONCEPTS`, `03 · ENTITIES`, `04 · WIKI`) plus semantic relations, selective approval checkboxes (`.diff-concept-cb`, `.diff-relation-cb`, `.diff-claim-cb`), and isolated `Held Back` / `Blocked` sections.
* **Bottom Single Prompt Composer (`#prompt-dock`, `bottom: 18px`)**:
  * Includes live prompt token preprocessing preview (`#prompt-preprocess-bar`) that scatters meaningful tokens into the 3D Black Hole as you type, optional raw text drawer (`#raw-source-drawer`), quick-try preset pills, and a unified `Ask` / `Ingest + Ask` input bar.
