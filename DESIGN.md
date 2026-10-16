# DESIGN.md — Visual, Spatial & Interaction Specification

> **Document Governance**: This document defines the **UI layout, 3D spatial aesthetics, color system, and interaction states** for **Project IDEA**. Product scope, pipeline stages, and Acceptance Criteria (`AC-01`–`AC-10`) live in [`PRD.md`](file:///Users/beomsu/Documents/antigravity/deepmind%20hackathon/PRD.md). Repository boundaries and multi-agent operating rules live in [`AGENTS.md`](file:///Users/beomsu/Documents/antigravity/deepmind%20hackathon/AGENTS.md).

---

## 1. Aesthetic Direction & References

### 1.1 Persona: Dark 3D Knowledge Constellation
Project IDEA adopts a **Dark 3D Knowledge Constellation** aesthetic that visualizes knowledge assimilation as a living cosmic observatory. The previous bright/Google-primary theme is deprecated in favor of a deep space environment where semantic structures, citations, and pending proposals shine with restrained **Cyan, Blue, and Violet** luminescence.

* **Primary Reference**:
  * **CareerHackerAlex Second Brain (`https://www.careerhackeralex.com/memory`)**: Deep dark cosmic void, luminous star-like nodes with soft radial halos, ultra-thin translucent constellation filaments, floating high-contrast node labels, fluid 3D orbit/zoom navigation, interactive lens filtering, and click-to-read node inspection. (Adapted to IDEA's left-to-right assimilation flow rather than copying its sidebar layout verbatim.)
* **Additional Spatial & Interaction References**:
  * **Arena3D Web (`https://www.arena3d.org/`)**: Stratified multilayer 3D graph planes and inter-layer relational edges (`Terms` → `Concepts & Entities` → `Grounded Claims`).
  * **WebGL Black Hole (`https://webgl-black-hole.vercel.app/`)**: Left-side gravitational event horizon with multi-layered glowing accretion rings and inward particle vortex.
  * **3D Force Graph — Click-to-Focus (`https://vasturiano.github.io/3d-force-graph/example/click-to-focus/`)**: Smooth camera interpolation (`lerp`) toward a clicked node and its immediate neighborhood while pausing/slowing ambient rotation.
  * **3D Force Graph — Emit Particles (`https://vasturiano.github.io/3d-force-graph/example/emit-particles/`)**: Directional light pulses traveling along edges to show provenance flow (`Black Hole → Semantic Space → White Hole`).
  * **Ataraxia Knowledge Graph (`https://ataraxia.ai.kr/?node=records`)**: Clean node-to-record inspection and unobtrusive spatial navigation cues (`Drag to orbit · Scroll to zoom · Click any node to inspect evidence`).

### 1.2 Color Palette (Deep Space + Restrained Cyan / Blue / Violet Luminescence)
Google primary colors are no longer required design primitives. Visual hierarchy is established through deep navy-black depth, translucent dark glassmorphism, and restrained luminous accents:

| Token Role | Hex / Value | Usage |
| :--- | :--- | :--- |
| **Deep Cosmic Void (Canvas Base)** | `#05070F` (`0x05070f`) | Primary WebGL scene background and `:root` surface (`color-scheme: dark`) |
| **Nebula Vignette Gradient** | `#090F20` → `#04060C` | Subtle radial depth backdrop behind the 3D constellation |
| **Dark Glass HUD Surface** | `rgba(9, 14, 28, 0.84)` | Top header bar, Knowledge Card drawer, and bottom Prompt Composer (`backdrop-filter: blur(20px) saturate(160%)`) |
| **Elevated Card / Sub-panel** | `rgba(15, 23, 42, 0.78)` | Evidence blocks, diff item rows, citation cards, and provenance badges |
| **Subtle Structural Border** | `rgba(148, 163, 184, 0.16)` | Hairline borders for HUD panels, pills, and dividers |
| **Active Luminous Border** | `rgba(56, 189, 248, 0.42)` | Focused prompt dock, active lens pill, and selected node card border |
| **Primary Typography** | `#F1F5F9` (Slate 100) | Headings, node titles, wiki synthesis prose, and prompt input |
| **Secondary Typography** | `#94A3B8` (Slate 400) | Descriptions, relation labels, source metadata, and helper copy |
| **Muted / Technical Metadata** | `#64748B` (Slate 500) | Interaction IDs, coordinates, and subtle keyboard/mouse hints |
| **Terms / Jargon Accent (Ring 1)** | `#38BDF8` (Electric Cyan) | Inner orbital layer (`x = -7.5`), Term octahedron nodes, and inflow accents |
| **Concepts Accent (Ring 2)** | `#60A5FA` (Celestial Blue) | Middle orbital layer (`x = 0.0`) core Concept nodes and primary edges |
| **Entities Accent (Ring 2)** | `#A78BFA` (Luminous Violet) | Middle orbital layer (`x = 0.0`) Entity prism nodes and cross-layer links |
| **Grounded Claims Accent (Ring 3)** | `#818CF8` / `#2DD4BF` (Indigo-Teal) | Outer orbital layer (`x = +7.5`) verified Claim torus nodes |
| **White Hole / Approved Wiki** | `#2DD4BF` / `#38BDF8` (Cyan-Teal) | Right-side White Hole (`x = +22`) synthesis rings, outflow particles, and `Verified` badges |
| **Pending / Proposed ChangeSet** | `#F59E0B` (Amber Pulse) | Unapproved candidate nodes/edges, pulsing wireframe shells, and `Proposed` diff state |
| **Conflict / Blocked Gate** | `#F43F5E` (Crimson Rose) | `UNRESOLVED` semantic conflicts and mechanically `Blocked` (`REJECTED`) claims |

### 1.3 Typography & Native Browser UI
* **Sans-Serif UI & Prose**: `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
* **Technical Metadata, IDs & Verbatim Quotes**: `'JetBrains Mono', monospace`
* **Dark-First Native Controls**: `<meta name="color-scheme" content="dark">` and `:root { color-scheme: dark; accent-color: #38bdf8; }` ensure native scrollbars, text selection, and form controls match the dark constellation canvas without white flashes (FOUC).

---

## 2. Core Spatial Architecture (Single Continuous WebGL Scene)

The entire viewport (`100vw × 100vh`, `overflow: hidden`) is a **single continuous Three.js WebGL 3D scene**. The three spatial zones must be simultaneously visible in the default camera framing (`camera.position = (0, 11, 40)`, `controls.target = (0, -1.5, 0)`):

```
[ Left: BLACK HOLE (x = -22) ]  ───►  [ Center: ROTATING SEMANTIC SPACE (x = -7.5 .. +7.5) ]  ───►  [ Right: WHITE HOLE (x = +22) ]
   Raw URL / Source Ingestion           Ring 1: Terms (-7.5) · Ring 2: Concepts (0) · Ring 3: Claims (+7.5)      Approved Living Wiki Output
```

1. **Left — Black Hole (`x = -22, y = 0, z = 0`)**:
   * **Visuals**: Deep pitch-black event horizon core surrounded by a subtle cyan/violet gravitational lensing halo, tilted multi-layer luminous accretion disks (`Cyan #38BDF8`, `Blue #3B82F6`, `Violet #8B5CF6`), and a spiraling inward particle vortex.
   * **Role**: Entry portal where new URLs and raw source documents are absorbed. During ingestion and pending review, animated inflow threads and traveling particles connect the Black Hole to newly proposed nodes in the Semantic Space.
   * **Interactive Portal**: Clicking the Black Hole in 3D or its `BLACK HOLE · SOURCE` spatial pill inspects the active source document, ingestion status, and raw anchor inventory.

2. **Center — Rotating Semantic Knowledge Space (`x = -7.5` to `+7.5`)**:
   * **3 Stratified Orbital Layers**:
     * **Inner Orbit (`x = -7.5`, Cyan `#38BDF8`)**: **Terms & Jargon (`TERM`)** — Domain acronyms and technical vocabulary rendered as luminous octahedra with soft star-glow halos.
     * **Middle Orbit (`x = 0.0`, Blue `#60A5FA` & Violet `#A78BFA`)**: **Concepts (`CONCEPT`) & Entities (`ENTITY`)** — Canonical semantic concepts (icosahedra/spheres) and named entities/authors/benchmarks (faceted prisms) where synonym alignment (`MATCH`) and new node proposals (`PROPOSE`) occur.
     * **Outer Orbit (`x = +7.5`, Indigo-Teal `#818CF8` / `#2DD4BF`)**: **Grounded Claims (`CLAIM`)** — Atomic factual statements backed by verbatim source quotes, rendered as ringed torus cores.
   * **Constellation Filaments & Directional Particle Flow**:
     * Thin, anti-aliased translucent lines connect Terms → Concepts → Claims, with subtle inter-concept relational bridges.
     * Travelling light particles (`emit-particles` pattern) flow along edges from left to right, accelerating along active provenance paths when a node is selected or queried.
   * **Visual Distinction of Proposed vs. Verified Knowledge**:
     * **Verified / Seed Knowledge**: Steady cyan, blue, violet, or teal luminescence with solid constellation filaments connected toward the White Hole.
     * **Proposed / Pending Knowledge (`PROPOSED`)**: Pulsing amber-gold (`#F59E0B`) node core encased in a rotating wireframe shell, tethered to the Black Hole via dashed inflow lines until the user approves or rejects the ChangeSet.
     * **Unresolved Conflict (`UNRESOLVED`)**: Pulsing crimson-rose (`#F43F5E`) warning shell highlighting contradictory claims that require human inspection.

3. **Right — White Hole (`x = +22, y = 0, z = 0`)**:
   * **Visuals**: Radiant cyan-white synthesis core (`#ECFEFF` / `#38BDF8`) surrounded by counter-rotating teal/violet/blue harmonic rings and an outward-flowing stream of luminous knowledge particles.
   * **Role**: Exit portal where user-approved knowledge crystallizes into the session's **Living Wiki**. Verified claims project delicate synthesis filaments into the White Hole.
   * **Interactive Portal**: Clicking the White Hole in 3D or its `WHITE HOLE · WIKI` spatial pill opens the synthesized Living Wiki overview showing all seed and session-assimilated concepts and claims.

---

## 3. HUD Layout & Non-Occluding Overlay Ergonomics

To preserve the 3D spatial continuity of **Black Hole → Semantic Space → White Hole**, floating UI chrome is minimal, translucent, and strictly bounded so it never permanently covers the left or right portals:

* **Top Telemetry & Constellation Lens Bar (`height: 52px`)**:
  * **Left**: Project IDEA emblem + subtitle (`Dark 3D Knowledge Constellation`).
  * **Center-Left**: Live **Execution & Verification Stage Badge** (`Idle`, `Ingesting`, `Aligning`, `Mechanical Check`, `Self-Correction`, `Ready for Review`, `Assimilated`) reflecting real backend/Argon pipeline states.
  * **Center-Right**: Live graph counters (`Terms · Concepts · Claims`), interactive **Constellation Lenses** (`All`, `Terms`, `Concepts`, `Claims`, `Pending`), and a prominent `Review Diff (N)` action button when a ChangeSet is pending.
  * **Right**: `Reset view` (smooth camera return), `Reset session` (restores seed graph), and active runtime badge (`gemini-4-argon`).
* **Spatial Portal Pills (`top: 64px`)**:
  * Left pill (`left: 20px`): `BLACK HOLE · SOURCE` with active URL/source badge.
  * Center pill (`left: 50%`): Stratified orbital legend (`Terms → Concepts & Entities → Grounded Claims`).
  * Right pill (`right: 20px`): `WHITE HOLE · WIKI` with verified node counter.
* **Non-Occluding Knowledge Card & Diff Drawer (`#overlay-card`)**:
  * Positioned as a centered, floating dark-glass panel above the prompt dock (`bottom: 108px`, `left: 50%`, `transform: translateX(-50%)`, `width: min(660px, calc(100vw - 380px))`, `max-height: min(430px, calc(100vh - 220px))`).
  * Because its width leaves at least `190px` of open canvas on both the left and right margins (and includes a 1-click **Minimize / Collapse** toggle plus `ESC` / close button), **the right White Hole and left Black Hole remain continuously visible even while reviewing diffs or reading node evidence**.
  * Contains three unified tabs:
    1. **Query Answer (`#view-answer`)**: Grounded Argon synthesis, clickable inline citations `[1]`, referenced 3D node chips, and verification badges (`Mutated Wiki: False`).
    2. **Node Evidence (`#view-node`)**: Selected node's layer/status badges, description, synonyms, connected 1-hop constellation neighbors (clickable to jump focus), and **Grounded Claims & Verbatim Quotes** with `Mechanical Quote Match` and section anchor metadata.
    3. **Knowledge Diff (`#view-diff`)**: Interactive Argon pipeline trace (Turn-1 extraction, Mechanical Validator gate, Turn-2 `previous_interaction_id` self-correction), selective approval checkboxes for each `PROPOSED` concept/relation/claim, read-only isolation for `UNRESOLVED` conflicts and `Blocked` (`REJECTED`) claims, and `Approve Selected` / `Approve All` / `Reject` buttons.
* **Bottom Single Prompt Composer (`#prompt-dock`, `bottom: 18px`)**:
  * Always visible at the bottom center (`width: min(720px, calc(100vw - 32px))`).
  * Single unified input accepting natural-language questions, public URLs (`https://...`), or mixed `URL + question` prompts, with an automatic mode indicator (`ASK WIKI`, `INGEST URL`, `INGEST + ASK`, `TEXT DOC`) and quick-try chips for 1-click demo verification.

---

## 4. Interactive Camera & Constellation Physics

1. **Free 3D Orbit, Pan & Zoom**:
   * Left-drag orbits 360°, scroll wheel zooms (`minDistance: 8`, `maxDistance: 75`), right-drag pans.
2. **Node Click → Smooth Camera Focus (`click-to-focus`)**:
   * Clicking any 3D node (or its floating label pill) pauses orbital rotation (`isRotationPaused = true`), smoothly interpolates `controls.target` toward the clicked node's 3D coordinates, and glides `camera.position` to an optimal viewing offset framing the node and its connected 1-hop edges.
   * Non-connected background nodes dim softly (`opacity: 0.16`) while the selected node, its 1-hop neighbors, and the active provenance path from the Black Hole or toward the White Hole illuminate with accelerated edge particles.
3. **Approval Assimilation Burst**:
   * Approving a ChangeSet triggers a luminous cyan/teal particle burst on the newly approved nodes, transitions their geometry from pulsing Amber (`PROPOSED`) to steady Verified luminescence, and establishes synthesis filaments into the right White Hole.
4. **Reset View (`resetViewCamera`)**:
   * Clicking empty space, closing the card, or pressing `Reset view` smoothly interpolates the camera back to `(0, 11, 40)` and resumes gentle orbital rotation.
