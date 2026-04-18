# Survey Drafting Engine — MVP Plan

## Phase 1 Focus: Point Cloud Import & Rendering

---

## Performance Philosophy

Performance is not a feature — it is a constraint on every story. No milestone is complete unless it meets its performance targets. The goal is AutoCAD-level performance or better for the tracing workflow.

AutoCAD's point cloud rendering is known to be sluggish with large clouds — it is a feature bolted onto a CAD system, not a core design goal. We are building purpose-built. That is the advantage.

### Targets

| Metric | Target |
|---|---|
| Viewport frame rate | 60fps sustained during navigation |
| Visible point budget | Up to 5M points rendered per frame |
| Node streaming latency | < 100ms from camera stop to new nodes visible |
| First points visible (after conversion) | < 3s from project open |
| Raycast response (tracing click) | < 16ms (one frame) |
| LAZ → COPC conversion | Background, non-blocking, progress shown |

### Non-negotiable implementation rules

1. **Binary Tauri IPC** — byte arrays never go through JSON. Use raw binary responses.
2. **Web Worker for decoding** — laz-perf runs off the main thread. The viewport never blocks on I/O.
3. **Pre-allocated buffer pool** — no `new Float32Array()` per node. Allocate once, write in place.
4. **Point budget enforced** — LOD algorithm caps visible points. GPU is never overloaded.
5. **Rust owns all file I/O** — no file reads in JavaScript. COPC file is memory-mapped on project open (`memmap2`) — zero syscall overhead per node read.
6. **No blocking the main thread** — conversion, decoding, inference all run async or in workers.

---

## The Core Challenge

Mobile mapper point clouds are large — confirmed 13GB+ per file. You cannot naively load them into memory. The rendering strategy must account for this from day one.

The key constraint is: **Level of Detail (LOD) streaming** — load only the points visible at the current zoom/distance, and progressively refine as the user zooms in.

---

## Stack

```
Desktop shell:   Tauri (Rust native — Rust backend is the Tauri core, no sidecar)
Frontend:        React + TypeScript
3D Rendering:    @react-three/fiber + @react-three/drei + Three.js (WebGL2)
Point Cloud:     copc.js (reads COPC via Tauri IPC, not HTTP)
LOD:             copc.js node hierarchy + frustum culling + screen-space error
State:           Zustand
UI:              Tailwind + shadcn/ui
Backend:         Rust (Tauri commands — file I/O, PDAL subprocess)
Conversion:      PDAL (CLI, invoked as Rust subprocess) — LAZ → COPC
Storage:         Local filesystem (files already on surveyor's machine)
```

---

## Data Formats

### Input: LAZ
Surveyors export **LAZ** directly from their scanner software. LAZ is lossless-compressed LAS — 10-20x smaller than raw LAS, handled natively by the full toolchain (PDAL, copc.js).

Files are already on the surveyor's local machine. No upload step.

### Internal: COPC
LAZ is converted to **COPC** (Cloud Optimized Point Cloud) on first open. COPC is a single-file octree format — the Rust backend reads arbitrary byte ranges directly from disk to stream LOD nodes to the WebView.

### Other formats (future, not MVP):
- **E57** — PDAL supports it, low priority
- **LAS** — uncompressed, no reason to prefer over LAZ
- **RCP / RCS** — Autodesk proprietary, requires ReCap SDK — skip

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Tauri WebView (React)               │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │   Main Viewport   │  │  Side Viewports (2x) │ │
│  │  (orbit/pan/zoom) │  │  (alt angles)        │ │
│  │  R3F Canvas       │  │  R3F Canvas (shared  │ │
│  │                   │  │  scene, diff camera) │ │
│  └──────────────────┘  └──────────────────────┘ │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  Point Cloud Manager (Zustand)             │  │
│  │  - loaded nodes, visible nodes             │  │
│  │  - camera frustum subscription             │  │
│  │  - streaming queue                         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  copc.js reader                            │  │
│  │  - requests node data via Tauri IPC        │  │
│  │  - decodes LAZ chunks via laz-perf (WASM)  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────┘
                           │ Tauri commands (IPC)
┌──────────────────────────▼──────────────────────┐
│           Rust Core (Tauri backend)              │
│  - memory-maps .copc file on project open        │
│  - spawns PDAL subprocess for LAZ → COPC         │
│  - stores project metadata (SQLite)              │
│  - stores traced geometry (GeoJSON)              │
└─────────────────────────────────────────────────┘
```

---

## Data Pipeline

Surveyor opens a LAZ file. On first open, the Rust backend converts it:

```
LAZ (on surveyor's desktop)
   ↓
Rust spawns PDAL subprocess
   ↓
COPC (.copc.laz)  ← single file, stored alongside LAZ on surveyor's drive
   ↓
Memory-mapped on project open (memmap2)
```

```bash
pdal translate input.laz output.copc.laz --writers.copc
```

Runs as a background Tauri command. Progress streamed back to the UI via Tauri events.

PDAL is bundled with the installer including all dependencies (GDAL, GEOS, proj). App size is not a constraint.

---

## LOD & Streaming Strategy

COPC files are organized as an octree. The root node is a coarse sample of the entire cloud. Children are progressively denser samples of sub-regions. The LOD algorithm decides which level of this tree to load at any given moment.

### Why screen-space error, not distance

Distance-based LOD loads denser nodes when the camera is physically close. Screen-space error loads denser nodes when a node would look visibly coarse on screen — accounting for zoom level and viewport size. At high zoom, you need detail even if the camera hasn't moved. Screen-space error handles this correctly; distance-based does not.

### Algorithm (runs on camera change)

```
1. Load COPC header + hierarchy (once, on project open)
2. On each camera change:
   a. Start at root node
   b. Is this node outside the camera frustum? → skip entire subtree
   c. Project node's geometric error onto screen (pixels)
      - Below threshold → render this node, stop recursing
      - Above threshold → recurse into children (need more detail)
   d. Build load queue: nodes needed but not yet in memory, sorted by screen-space error (highest priority first)
   e. Build unload list: nodes in memory no longer needed
3. Enforce 5M point budget — if over, evict lowest-priority loaded nodes
4. Process load queue: Rust reads byte ranges → Worker decodes → BufferGeometry updated
```

### Streaming steps (per node load)

1. Rust reads node byte range from memory-mapped COPC file (`memmap2` — direct memory access, zero syscall overhead per read)
2. Raw bytes transferred to WebView via binary Tauri IPC
3. Bytes handed to Web Worker (no main thread involvement)
4. laz-perf decodes LAZ chunk inside Worker
5. Decoded Float32Array written into pre-allocated buffer pool slot
6. Main thread notified → `BufferAttribute.needsUpdate = true`
7. Three.js renders updated geometry next frame

### Performance notes

- Node eviction must happen before allocation — never exceed the buffer pool size
- Load queue is re-evaluated every camera change, not every frame
- Nodes already in memory are never re-fetched — track loaded set in Zustand
- Cursor-proximity bias (Phase 2): boost priority of nodes near the active trace cursor

---

## Multi-Viewport Architecture

Single R3F canvas with `gl.setScissor` — renders multiple cameras into different regions of one canvas. More performant than multiple `<Canvas>` elements (avoids multiple WebGL contexts).

```
┌──────────────────────────────────────┐
│  One Canvas                          │
│  ┌─────────────────┐  ┌───────┐ ┌───┐│
│  │  Main view      │  │ Top   │ │ Rt ││
│  │  (primary cam)  │  │ view  │ │ view│
│  └─────────────────┘  └───────┘ └───┘│
└──────────────────────────────────────┘
```

All cameras share the same scene. When the cursor hovers a point in the main view, secondary views reframe to that point from their fixed angles.

---

## Coordinate System

Survey data uses real-world coordinates (State Plane, UTM) with large values (e.g., `X: 1,234,567.89`). Three.js uses 32-bit floats internally — precision loss at survey scales.

**Fix: rebase on load.** Subtract the bounding box center from all points, keep the offset in state, add it back on export. CRS metadata is preserved through COPC conversion and restored on export.

```
localPoint = realWorldPoint - origin
```

This must happen in the COPC reader before creating Three.js geometry.

---

## Project Persistence

```
{LAZ location}/
  scan.laz                  ← original, untouched
  scan.copc.laz             ← converted, stored alongside LAZ (same drive, fast reads)
  scan.traces.geojson       ← trace geometry, stored alongside

C:\Users\{user}\AppData\Roaming\survey-drafting-engine\
  survey.db                 ← SQLite, project metadata only (paths, names, dates)
```

COPC and traces live on the same drive as the original LAZ — not in AppData. Surveyors often store data on a dedicated fast drive (NVMe). Keeping converted files there avoids cross-drive I/O.

### Tauri commands (MVP)

```
create_project     { name, laz_path }          → project_id  ← COPC written alongside LAZ
list_projects                                  → Vec<ProjectMeta>
get_project        { project_id }              → ProjectMeta
convert_to_copc    { project_id }              → streams progress → done
read_copc_range    { project_id, offset, len } → bytes
save_traces        { project_id, geojson }     → ok
load_traces        { project_id }              → geojson
```

---

## Tracing

### Phase 2 — Manual tracing
Design the rendering layer now to support:
- Raycasting against point cloud → 3D intersection on click
- Snap to nearest point within radius
- Polyline drawing (successive clicks)
- Undo / redo

### Phase 3+ — AI-assisted tracing
Long-term goal: AI detects features and suggests or auto-generates trace geometry.

```
User selects region
   ↓
Rust clips COPC segment (PDAL crop filter)
   ↓
Inference runs
   ↓
Predicted geometry returned (lines, polylines, surfaces)
   ↓
User reviews, adjusts, confirms
```

**Inference stack: `ort` (ONNX Runtime)**

Rust binding for Microsoft's ONNX Runtime. Train a model in Python, export to ONNX once, run it via `ort` with no Python at runtime. GPU backends: CUDA (Nvidia), DirectML (Windows — any GPU brand), CoreML (Mac).

DirectML is critical for Windows surveyors — workstations vary in GPU brand (Nvidia, AMD, Intel). DirectML covers all of them.

**Inference options (in order of preference):**
1. **Rust via `ort`** — ONNX Runtime, runs on user's GPU (CUDA/DirectML), zero Python dependency, fully bundled
2. **In-browser via WebGPU** — `transformers.js` / ONNX Web Runtime. WebGL2 reliable in Tauri's WebView2; WebGPU compute on Windows may vary
3. **Remote API** — Claude or custom endpoint. Easiest to iterate on during research, requires internet

**Open questions for Phase 3:**
- **Which model architecture?** — PointNet++ (classic, well-understood), RandLA-Net (efficient large-scale segmentation), or other. Need to verify ONNX export and DirectML op compatibility before committing.
- **Pre-trained or fine-tuned?** — A general point cloud segmentation model will not understand survey-specific features (pipes, walls, survey markers). Fine-tuning on labeled survey data is likely required.
- **Training data** — Labeled survey point clouds needed for fine-tuning. Data collection should start during Phase 2, before Phase 3 begins.
- **Quantization** — INT8 quantization (4x smaller, faster on DirectML/CPU) vs FP32 accuracy tradeoff. Evaluate once a model is chosen.
- **Region size** — Inference runs on clipped segments, not the full cloud. Define max segment size based on model input constraints and GPU memory.

Design the data layer now so segments can be extracted and passed to any of these paths.

---

## Open Questions

- **E57 support** — low priority, but PDAL handles it when needed

---

## MVP Milestones (Phase 1)

Each milestone includes a performance acceptance criterion. A story is not done until the criterion is met.

- [ ] **1. Project scaffold** — Tauri + React + R3F boots, blank canvas renders at 60fps sustained
- [ ] **2. File open** — Native file picker selects LAZ; path handed to Rust backend; no JS file I/O; project record created in SQLite
- [ ] **3. PDAL conversion** — LAZ → COPC runs in Rust subprocess; progress events streamed to UI; viewport remains interactive during conversion
- [ ] **4. Memory-mapped COPC** — Rust memory-maps the `.copc.laz` file on project open via `memmap2`; no syscall overhead per node read; mmap handle stored in Tauri state
- [ ] **5. Binary IPC** — `read_copc_range` transfers node byte ranges as raw binary (not JSON); benchmark read of 1MB node < 10ms round-trip
- [ ] **6. copc.js Tauri adapter** — Thin adapter routes copc.js HTTP range requests to `read_copc_range` Tauri command; copc.js operates transparently without HTTP server
- [ ] **7. COPC header + hierarchy load** — COPC header and full node hierarchy loaded via copc.js + adapter; hierarchy stored in Zustand; completes < 1s after project open
- [ ] **8. Coordinate rebasing** — Bounding box center subtracted from all point coordinates before Three.js geometry; origin stored in Zustand for export restoration; no float precision artifacts at survey scale
- [ ] **9. First render** — Root node points rendered in Three.js using pre-allocated BufferGeometry pool; no `new Float32Array()` per node; first points visible < 3s from project open
- [ ] **10. Web Worker decoding** — laz-perf runs in a dedicated Worker; main thread frame rate does not drop below 60fps during any node decode
- [ ] **11. LOD streaming** — Nodes load/unload based on camera frustum + screen-space error; load queue processed via Rust → Worker → BufferGeometry pipeline; new nodes visible < 100ms after camera stops; point budget hard-capped at 5M
- [ ] **12. Navigation** — OrbitControls (pan, orbit, zoom) at 60fps sustained with full 5M point budget loaded
- [ ] **13. Persistence** — Project list persisted in SQLite; existing project reopens with COPC already converted; first points visible < 3s on reopen (no reconversion)
- [ ] **14. Multi-viewport** — Second camera (top-down) rendered via `gl.setScissor` on same canvas; both viewports maintain 60fps simultaneously
