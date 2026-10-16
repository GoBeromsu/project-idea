# Project IDEA — 3-Minute Video Demo Script

**Google DeepMind AI Hackathon Track 4**

---

### [00:00 - 00:30] Introduction & The Problem
- **Visual**: Show camera / title slide, then switch to naive wiki/notes with duplicate, disconnected pages.
- **Narrator**:
  > "When AI agents summarize technical papers and research notes, they constantly fall into three traps: Concept fragmentation, hallucinated quotes, and silent overwrites when facts contradict.
  > Today, we present **Project IDEA** — an Autonomous Knowledge Assimilation Engine built with **Gemini 4 Argon** and Google GenAI's **Interactions API**."

---

### [00:30 - 01:15] Architecture & 3D Visualizer
- **Visual**: Open [https://project-idea-529324293576.asia-northeast3.run.app](https://project-idea-529324293576.asia-northeast3.run.app). Rotate the 3D scene.
- **Narrator**:
  > "Here is our 4-layer 3D visualizer running live on Google Cloud Run.
  > At the bottom is the Source Evidence layer, above it is our canonical Domain Ontology, then the Knowledge Graph, and at the top, our Living Wiki.
  > Clicking any node reveals its exact verbatim evidence quote and provenance anchor."

---

### [01:15 - 02:15] Live Assimilation & Argon Self-Correction Loop
- **Visual**: Click "Sample Note", showing technical text with synonyms and claims. Click "Assimilate via gemini-4-argon".
- **Narrator**:
  > "Let's ingest this new technical note discussing Tree Search Heuristics.
  > Under the hood, Gemini 4 Argon extracts concepts and triples. Our deterministic Evidence Validator immediately checks if the cited quotes are 100% verbatim substrings in the raw source text.
  > If a quote doesn't match, Turn 2 triggers automatically via `previous_interaction_id`, letting Argon self-correct with 95% cached token discounts.
  > Notice the Knowledge Diff on the right: Instead of fragmenting into a new concept, Argon correctly recognized this as a synonym of Monte Carlo Tree Search."

---

### [02:15 - 02:45] Human-in-the-Loop Gate & Contradiction Handling
- **Visual**: Show the Knowledge Diff panel with pending claims and contradictions. Click "Approve & Commit".
- **Narrator**:
  > "Crucially, any contradictory statements are flagged as UNRESOLVED and never overwrite the database silently.
  > The Human-in-the-Loop review dock lets the user inspect the exact diff. Once we click 'Approve & Commit', the 3D graph updates dynamically."

---

### [02:45 - 03:00] Conclusion & Submission
- **Visual**: Show GitHub repo ([GoBeromsu/project-idea](https://github.com/GoBeromsu/project-idea)) and live URL.
- **Narrator**:
  > "Project IDEA turns chaotic web information into verified, grounded Living Wikis. Fully automated, mechanically verified, and powered by Gemini 4 Argon. Thank you!"
