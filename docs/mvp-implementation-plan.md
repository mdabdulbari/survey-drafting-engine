# Survey Drafting Engine — MVP Implementation Plan

This document is the implementation spec for Phase 1. It is intended for an agent to execute milestone by milestone. Each milestone is self-contained: it lists what to build, which files to create or modify, dependencies that must be complete first, and a clear acceptance test. No milestone is done until its acceptance test passes.

Read `docs/survey-mvp-plan.md` first for architecture context, performance targets, and the rationale behind each decision. This document does not repeat that context — it only specifies what to build.

---

## Repository Layout (target state after all milestones)

```
survey-drafting-engine/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      lib.rs
      state.rs                  ← AppState: mmap handles, db pool
      db.rs                     ← SQLite setup, migrations
      commands/
        project.rs              ← create_project, list_projects, get_project
        conversion.rs           ← convert_to_copc (PDAL subprocess)
        ipc.rs                  ← read_copc_range (binary IPC)
      migrations/
        001_init.sql
  src/
    main.tsx
    App.tsx
    store/
      pointCloudStore.ts        ← Zustand: loaded nodes, hierarchy, origin
    lib/
      copc-tauri-adapter.ts     ← Routes copc.js HTTP calls → Tauri IPC
      copc-reader.ts            ← Wraps copc.js with adapter
      coordinate-system.ts     ← Rebasing helpers
      buffer-pool.ts            ← Pre-allocated Float32Array pool
      lod-manager.ts            ← Frustum culling + screen-space error
    workers/
      laz-decoder.worker.ts     ← laz-perf off main thread
    components/
      Viewport.tsx              ← R3F Canvas, OrbitControls
      MultiViewport.tsx         ← Scissor-based dual camera
      PointCloud.tsx            ← Reads pool slots, updates BufferGeometry
      FileOpen.tsx              ← File picker → create_project
      ProjectList.tsx           ← List + open existing projects
      ConversionProgress.tsx    ← Progress bar for PDAL conversion
  docs/
    survey-mvp-plan.md
    mvp-implementation-plan.md
```

---

## Global Constraints (apply to every milestone)

- **No file I/O in JavaScript.** All reads go through Tauri commands.
- **No JSON for binary data.** `read_copc_range` returns `tauri::ipc::Response` (raw bytes).
- **No `new Float32Array()` per node.** All geometry uses the pre-allocated buffer pool.
- **No blocking the main thread.** Decoding runs in a Web Worker. Conversion runs async in Rust.
- **No per-frame Zustand subscriptions in hot paths.** Use `usePointCloudStore.getState()` inside `useFrame`.

---

## Milestone 1: Project Scaffold

**Goal:** Tauri app boots with a React + R3F canvas. Canvas renders at 60fps sustained (blank scene).

### Steps

1. Initialize Tauri project: `npm create tauri-app@latest survey-drafting-engine -- --template react-ts`
2. Install frontend dependencies:
   ```
   npm install three @react-three/fiber @react-three/drei zustand
   npm install -D tailwindcss @tailwindcss/vite
   npx shadcn@latest init
   ```
3. Configure Tailwind in `vite.config.ts` (use `@tailwindcss/vite` plugin).
4. Add Rust dependencies to `src-tauri/Cargo.toml`:
   ```toml
   [dependencies]
   tauri = { version = "2", features = [] }
   tokio = { version = "1", features = ["full"] }
   serde = { version = "1", features = ["derive"] }
   serde_json = "1"
   ```
5. Create `src/components/Viewport.tsx`:
   - R3F `<Canvas>` filling the window
   - `<OrbitControls>` from drei
   - `<Stats>` from drei (shows fps — leave in for all milestones, remove before ship)
   - Ambient light so the blank scene isn't black
6. `src/App.tsx` renders `<Viewport />`.

### Acceptance Test

- `npm run tauri dev` boots without errors.
- Canvas is visible. Stats panel shows ≥ 60fps with no scene content.
- No console errors.

---

## Milestone 2: File Open

**Goal:** User picks a LAZ file. Path is sent to Rust. Rust creates a project record in SQLite. No file reading in JS.

### Dependencies

Milestone 1 complete.

### Steps

**Rust:**

1. Add to `Cargo.toml`:
   ```toml
   sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio", "macros"] }
   uuid = { version = "1", features = ["v4"] }
   ```
2. Create `src-tauri/src/migrations/001_init.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     laz_path TEXT NOT NULL,
     copc_path TEXT NOT NULL,
     copc_ready INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   ```
3. Create `src-tauri/src/db.rs`:
   - `pub async fn init_db() -> sqlx::SqlitePool` — creates AppData dir if needed, opens `survey.db`, runs migrations.
4. Create `src-tauri/src/state.rs`:
   ```rust
   pub struct AppState {
       pub db: sqlx::SqlitePool,
   }
   ```
5. Wire `AppState` into Tauri builder in `main.rs`.
6. Create `src-tauri/src/commands/project.rs`:
   ```rust
   #[tauri::command]
   pub async fn create_project(
       state: tauri::State<'_, AppState>,
       name: String,
       laz_path: String,
   ) -> Result<String, String>
   ```
   - Validate `laz_path` exists on disk.
   - Derive `copc_path`: same directory as LAZ, stem + `.copc.laz`.
   - Insert row into `projects` table. Return `project_id`.

**Frontend:**

7. Create `src/components/FileOpen.tsx`:
   - Button: "Open LAZ File"
   - On click: `open()` from `@tauri-apps/plugin-dialog` with filter `{ name: 'LAZ', extensions: ['laz'] }`
   - On file selected: call `invoke('create_project', { name: fileName, lazPath })` 
   - Store returned `project_id` in Zustand.
8. Render `<FileOpen />` in `App.tsx`.

### Acceptance Test

- Clicking "Open LAZ File" opens native file picker.
- Selecting a `.laz` file: a project record appears in `survey.db` (verify with sqlite3 CLI).
- No `.laz` bytes are read in JavaScript (confirm with DevTools network tab — no file:// reads).
- Invalid path → error displayed in UI.

---

## Milestone 3: PDAL Conversion

**Goal:** After project creation, Rust converts LAZ → COPC in a background subprocess. Progress is streamed to UI as Tauri events. Viewport stays at 60fps during conversion.

### Dependencies

Milestone 2 complete. PDAL CLI must be available on PATH (bundled in final installer; for dev, install PDAL separately and ensure `pdal` is on PATH).

### Steps

**Rust:**

1. Create `src-tauri/src/commands/conversion.rs`:
   ```rust
   #[tauri::command]
   pub async fn convert_to_copc(
       app: tauri::AppHandle,
       state: tauri::State<'_, AppState>,
       project_id: String,
   ) -> Result<(), String>
   ```
   - Look up `laz_path` and `copc_path` from DB.
   - If `copc_ready = 1` and `copc_path` exists on disk → emit `conversion_done` event immediately, return.
   - Spawn subprocess: `tokio::process::Command::new("pdal").args(["translate", &laz_path, &copc_path, "--writers.copc"])`
   - Capture stdout line-by-line. Each line → emit Tauri event `conversion_progress { project_id, message }`.
   - On subprocess exit code 0: set `copc_ready = 1` in DB. Emit `conversion_done { project_id }`.
   - On non-zero exit: emit `conversion_error { project_id, message }`.

**Frontend:**

2. Create `src/components/ConversionProgress.tsx`:
   - Listens to `conversion_progress`, `conversion_done`, `conversion_error` Tauri events.
   - Shows a progress bar / log while conversion runs.
   - Hides on `conversion_done`.
3. Call `invoke('convert_to_copc', { projectId })` after project creation in `FileOpen.tsx`.

### Acceptance Test

- After selecting a LAZ file, conversion starts automatically.
- Progress messages appear in the UI.
- A `.copc.laz` file appears on disk alongside the original LAZ when done.
- During conversion, the R3F canvas continues to render at ≥ 60fps (check Stats panel).
- Second open of same project: `conversion_done` fires immediately, no PDAL subprocess spawned.

---

## Milestone 4: Memory-Mapped COPC File

**Goal:** On project open, Rust memory-maps the `.copc.laz` file. The mmap handle is stored in `AppState` keyed by `project_id`. All subsequent node reads use the mmap — no `File::open` per read.

### Dependencies

Milestone 3 complete (COPC file exists on disk).

### Steps

**Rust:**

1. Add to `Cargo.toml`:
   ```toml
   memmap2 = "0.9"
   ```
2. Update `src-tauri/src/state.rs`:
   ```rust
   use memmap2::Mmap;
   use std::collections::HashMap;
   use std::sync::Arc;
   use tokio::sync::RwLock;

   pub struct AppState {
       pub db: sqlx::SqlitePool,
       pub mmaps: RwLock<HashMap<String, Arc<Mmap>>>,
   }
   ```
3. Add Tauri command `open_project` in `commands/project.rs`:
   ```rust
   #[tauri::command]
   pub async fn open_project(
       state: tauri::State<'_, AppState>,
       project_id: String,
   ) -> Result<ProjectMeta, String>
   ```
   - Fetch project row from DB.
   - If `copc_ready = 1`: open file, create mmap, store in `state.mmaps` under `project_id`.
   - Return `ProjectMeta { id, name, laz_path, copc_path, copc_ready }`.

### Acceptance Test

- Call `open_project` via `invoke` after conversion completes.
- Confirm mmap is stored: subsequent `read_copc_range` calls (Milestone 5) succeed without opening the file again.
- No panics from mmap on a real `.copc.laz` file.

---

## Milestone 5: Binary IPC

**Goal:** `read_copc_range` reads a byte range from the memory-mapped COPC file and returns raw binary to the frontend — no JSON encoding, no base64.

### Dependencies

Milestone 4 complete.

### Steps

**Rust:**

1. Create `src-tauri/src/commands/ipc.rs`:
   ```rust
   #[tauri::command]
   pub async fn read_copc_range(
       state: tauri::State<'_, AppState>,
       project_id: String,
       offset: u64,
       len: u64,
   ) -> Result<tauri::ipc::Response, String>
   ```
   - Look up `Arc<Mmap>` from `state.mmaps`.
   - Slice: `&mmap[offset as usize..(offset + len) as usize]`.
   - Return `tauri::ipc::Response::new(slice.to_vec())`.
   - Bounds-check offset + len before slicing; return `Err` if out of range.

**Frontend benchmark (temporary, delete after test):**

2. Add a `<BenchmarkIPC />` component (behind a dev flag or just a button):
   - Read 1MB from offset 0: `invoke<ArrayBuffer>('read_copc_range', { projectId, offset: 0, len: 1_048_576 })`
   - Time it with `performance.now()`.
   - Log result to console.

### Acceptance Test

- `read_copc_range` returns an `ArrayBuffer` in JavaScript (not a string, not base64).
- 1MB read round-trip < 10ms (measured with `performance.now()`).
- Out-of-bounds request returns an error, not a panic.

---

## Milestone 6: copc.js Tauri Adapter

**Goal:** copc.js expects to make HTTP range requests (via `fetch`). Build a thin adapter that intercepts those requests and routes them to `read_copc_range` instead. copc.js operates without an HTTP server.

### Dependencies

Milestone 5 complete.

### Steps

**Frontend:**

1. Install copc.js: `npm install copc.js`

2. Create `src/lib/copc-tauri-adapter.ts`:

   copc.js accepts a `Getter` function: `(filename: string, offset: number, length: number) => Promise<Uint8Array>`.

   ```typescript
   import { invoke } from '@tauri-apps/api/core';

   export function makeTauriGetter(projectId: string) {
     return async (
       _filename: string,
       offset: number,
       length: number
     ): Promise<Uint8Array> => {
       const buffer = await invoke<ArrayBuffer>('read_copc_range', {
         projectId,
         offset,
         len: length,
       });
       return new Uint8Array(buffer);
     };
   }
   ```

3. Verify copc.js accepts a `Getter` in its `Copc.create(getter)` API (check copc.js source / README). Adjust the adapter signature if the API differs.

### Acceptance Test

- `makeTauriGetter` returns a function that, when called with a test offset/length, returns a `Uint8Array` containing the correct bytes from the COPC file.
- No HTTP server is running. No `fetch` to a file:// or http:// URL.

---

## Milestone 7: COPC Header + Hierarchy Load

**Goal:** Use copc.js with the Tauri adapter to load the COPC header and the full node hierarchy. Store hierarchy in Zustand. Complete within 1 second of project open.

### Dependencies

Milestone 6 complete.

### Steps

**Frontend:**

1. Create `src/lib/copc-reader.ts`:
   ```typescript
   import { Copc } from 'copc.js';
   import { makeTauriGetter } from './copc-tauri-adapter';

   export async function loadCopc(projectId: string, copcPath: string) {
     const getter = makeTauriGetter(projectId);
     // copc.js uses the path string as the filename argument to getter
     const copc = await Copc.create(copcPath, getter);
     const { nodes } = await copc.loadHierarchyPage(copc.info.rootHierarchyPage);
     return { copc, nodes };
   }
   ```

2. Create `src/store/pointCloudStore.ts`:
   ```typescript
   import { create } from 'zustand';
   import type { Copc } from 'copc.js';

   interface PointCloudState {
     projectId: string | null;
     copc: Copc | null;
     hierarchy: Record<string, NodeInfo> | null;  // keyed by node key string
     origin: [number, number, number] | null;
     loadedNodes: Set<string>;
     setCopc: (projectId: string, copc: Copc, hierarchy: Record<string, NodeInfo>) => void;
     setOrigin: (origin: [number, number, number]) => void;
     markLoaded: (nodeKey: string) => void;
     markUnloaded: (nodeKey: string) => void;
   }

   export const usePointCloudStore = create<PointCloudState>((set) => ({ ... }));
   ```

3. After `open_project` resolves and conversion is done, call `loadCopc(projectId, copcPath)` and dispatch to Zustand.

### Acceptance Test

- After project open, `usePointCloudStore.getState().hierarchy` is non-null and contains > 0 nodes.
- Load completes in < 1s (log `performance.now()` before and after `loadCopc`).
- No HTTP requests in DevTools network tab.

---

## Milestone 8: Coordinate Rebasing

**Goal:** Subtract the COPC bounding box center from all point coordinates before creating Three.js geometry. Store the origin offset in Zustand. No float precision artifacts visible at survey scale.

### Dependencies

Milestone 7 complete (COPC header available, which contains the bounding box).

### Steps

**Frontend:**

1. Create `src/lib/coordinate-system.ts`:
   ```typescript
   import type { Copc } from 'copc.js';

   export function computeOrigin(copc: Copc): [number, number, number] {
     const { min, max } = copc.info.cube;
     return [
       (min[0] + max[0]) / 2,
       (min[1] + max[1]) / 2,
       (min[2] + max[2]) / 2,
     ];
   }

   // Apply after decoding a node's raw point buffer
   // points: Float32Array of [x, y, z, x, y, z, ...]
   export function rebasePoints(
     points: Float32Array,
     origin: [number, number, number]
   ): void {
     for (let i = 0; i < points.length; i += 3) {
       points[i]     -= origin[0];
       points[i + 1] -= origin[1];
       points[i + 2] -= origin[2];
     }
   }
   ```

2. After `loadCopc`, call `computeOrigin(copc)` and store in Zustand via `setOrigin`.
3. `rebasePoints` is called inside the Web Worker (Milestone 10) after laz-perf decoding, before posting the buffer back to the main thread.

### Acceptance Test

- After load, `usePointCloudStore.getState().origin` is a `[x, y, z]` triple derived from the COPC bbox center.
- Point coordinates passed to Three.js are centered near `[0, 0, 0]` (log a sample point to verify).
- No visible floating-point jitter when navigating — points hold their position at full zoom.

---

## Milestone 9: First Render

**Goal:** Root node points rendered in Three.js using a pre-allocated BufferGeometry pool. No `new Float32Array()` per node. First points visible < 3s from project open.

### Dependencies

Milestone 8 complete.

### Steps

**Frontend:**

1. Create `src/lib/buffer-pool.ts`:
   ```typescript
   const MAX_POINTS = 5_000_000;
   const FLOATS_PER_POINT = 3; // x, y, z

   export class BufferPool {
     private slots: Float32Array[];
     private free: number[];

     constructor(slotCount: number, pointsPerSlot: number) {
       this.slots = Array.from({ length: slotCount }, () =>
         new Float32Array(pointsPerSlot * FLOATS_PER_POINT)
       );
       this.free = this.slots.map((_, i) => i);
     }

     acquire(): { slotIndex: number; buffer: Float32Array } | null {
       const slotIndex = this.free.pop();
       if (slotIndex === undefined) return null;
       return { slotIndex, buffer: this.slots[slotIndex] };
     }

     release(slotIndex: number): void {
       this.free.push(slotIndex);
     }

     getBuffer(slotIndex: number): Float32Array {
       return this.slots[slotIndex];
     }
   }

   // Singleton — allocated once at app start
   export const bufferPool = new BufferPool(
     64,           // up to 64 nodes in memory simultaneously
     MAX_POINTS / 64  // ~78k points per slot
   );
   ```
   Tune `slotCount` and `pointsPerSlot` to fit the 5M budget: total floats across all slots = 5M × 3.

2. Create `src/components/PointCloud.tsx`:
   - Reads `loadedNodes` from Zustand.
   - For each loaded node, renders a `<points>` with a `<bufferGeometry>` whose position attribute points to the pool slot's `Float32Array`.
   - Uses `BufferAttribute.needsUpdate = true` (set this only when a slot is updated, not every frame).

3. For the first render milestone: load the root node synchronously (no Worker yet — defer to Milestone 10):
   - Request root node bytes via `read_copc_range`.
   - Decode with laz-perf on main thread (temporary — Worker replaces this in M10).
   - Write into pool slot.
   - Add to `loadedNodes` in Zustand.

4. Add `<PointCloud />` to `<Viewport />`.

### Acceptance Test

- First points appear on screen < 3s after project opens (measure from `open_project` invoke to first non-empty render).
- No `new Float32Array()` calls in the node load path (audit with a temporary console.trace or code review).
- Stats panel shows ≥ 60fps after points appear.

---

## Milestone 10: Web Worker Decoding

**Goal:** laz-perf decoding moved to a Web Worker. Main thread never blocks on decoding. Frame rate stays ≥ 60fps during any node decode.

### Dependencies

Milestone 9 complete.

### Steps

**Frontend:**

1. Create `src/workers/laz-decoder.worker.ts`:
   ```typescript
   import { LazPerf } from 'laz-perf';

   // Worker receives: { type: 'decode', nodeKey: string, rawBytes: ArrayBuffer, origin: [number, number, number] }
   // Worker posts back: { type: 'decoded', nodeKey: string, points: Float32Array } (transferable)

   self.onmessage = async (e) => {
     const { type, nodeKey, rawBytes, schema, origin } = e.data;
     if (type === 'decode') {
       const lazPerf = await LazPerf.create();
       const points = lazPerf.decompress(new Uint8Array(rawBytes), schema);
       // rebase in worker
       for (let i = 0; i < points.length; i += 3) {
         points[i]     -= origin[0];
         points[i + 1] -= origin[1];
         points[i + 2] -= origin[2];
       }
       self.postMessage({ type: 'decoded', nodeKey, points }, [points.buffer]);
     }
   };
   ```
   Note: `LazPerf.create()` can be cached after first init — do not recreate per message.

2. In the main thread node-loading path, replace the inline laz-perf call:
   - Post `{ type: 'decode', nodeKey, rawBytes, schema, origin }` to the worker (transfer `rawBytes`).
   - On `message` from worker: write `points` into the pre-allocated pool slot (copy — the transferred buffer is now owned by the main thread), set `BufferAttribute.needsUpdate = true`.

3. Use `Vite`'s worker import syntax: `new Worker(new URL('../workers/laz-decoder.worker.ts', import.meta.url), { type: 'module' })`.

### Acceptance Test

- During a node decode, the Stats panel fps does not drop below 60.
- DevTools Performance tab shows no long tasks on the main thread during decode.
- Decoded points appear correctly on screen (no corruption from transfer).

---

## Milestone 11: LOD Streaming

**Goal:** Full LOD system. Nodes load and unload based on camera frustum + screen-space error. New nodes visible < 100ms after camera stops. Point budget hard-capped at 5M.

### Dependencies

Milestone 10 complete.

### Steps

**Frontend:**

1. Create `src/lib/lod-manager.ts`:

   ```typescript
   import * as THREE from 'three';

   interface NodeInfo {
     key: string;       // COPC node key (e.g. "0-0-0-0")
     offset: number;    // byte offset in COPC file
     byteSize: number;
     pointCount: number;
     bounds: THREE.Box3;
     geometricError: number;
     children: string[];
   }

   export class LodManager {
     private camera: THREE.Camera;
     private renderer: THREE.WebGLRenderer;
     private hierarchy: Record<string, NodeInfo>;
     private loadedNodes: Set<string>;
     private maxPoints: number = 5_000_000;
     private errorThresholdPixels: number = 4; // tune this

     // Returns: { toLoad: NodeInfo[], toUnload: string[] }
     evaluate(frustum: THREE.Frustum): { toLoad: NodeInfo[]; toUnload: string[] }

     private screenSpaceError(node: NodeInfo, frustum: THREE.Frustum): number
     // Projects node.geometricError onto screen pixels using camera fov + viewport height
   }
   ```

   **Algorithm (see survey-mvp-plan.md for full description):**
   - Start at root node.
   - If node bounds outside frustum → skip subtree.
   - Compute screen-space error (pixels). If below threshold → add to render set, stop recursing. If above → recurse children.
   - Build `toLoad` (in render set, not yet loaded), `toUnload` (loaded, not in render set).
   - Sort `toLoad` by screen-space error descending (highest priority first).
   - Enforce point budget: if loading `toLoad` would exceed 5M, trim lowest-priority items.

2. Wire into `<Viewport />` via `useFrame`:
   ```typescript
   useFrame(({ camera, gl }) => {
     const frustum = new THREE.Frustum();
     frustum.setFromProjectionMatrix(
       new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
     );
     const { toLoad, toUnload } = lodManager.evaluate(frustum);
     // Process toUnload: release pool slots, remove from loadedNodes
     // Process toLoad: invoke read_copc_range → post to Worker
   });
   ```
   Only re-evaluate when camera has moved (compare matrices frame-to-frame). Do not re-evaluate every frame if camera is static.

3. Process load queue asynchronously — do not block `useFrame`. Use a loading queue with concurrency limit (e.g., max 4 concurrent node fetches).

### Acceptance Test

- Navigate around a large point cloud. New detail appears as camera stops and zooms in.
- Time from camera stop to new nodes visible: < 100ms (measure with `performance.now()` in the load queue processor).
- Open Chrome DevTools → Memory → verify point buffer never exceeds 5M × 3 × 4 bytes = 60MB for positions.
- Stats panel shows ≥ 60fps while streaming.

---

## Milestone 12: Navigation

**Goal:** OrbitControls (pan, orbit, zoom) at 60fps sustained with full 5M point budget loaded.

### Dependencies

Milestone 11 complete.

### Steps

**Frontend:**

1. `<OrbitControls>` from `@react-three/drei` is already in `<Viewport />` from Milestone 1. Verify settings:
   - `enableDamping={true}` (smooth deceleration)
   - `dampingFactor={0.05}`
   - `minDistance` / `maxDistance` set to reasonable survey-scale values (e.g. 0.1m – 5000m)
   - `panSpeed` / `rotateSpeed` tuned to feel responsive

2. Camera update: on every OrbitControls move, trigger LOD re-evaluation (already handled by `useFrame` in M11 if camera matrix changes are detected).

### Acceptance Test

- Pan, orbit, and zoom with 5M points loaded.
- Stats panel holds ≥ 60fps throughout all navigation modes.
- No stuttering or jank during continuous orbit.

---

## Milestone 13: Persistence

**Goal:** Project list persists across app restarts. Reopening an existing project skips conversion. First points visible < 3s on reopen.

### Dependencies

Milestone 4 complete (DB schema already exists from M2; mmap setup from M4).

### Steps

**Rust:**

1. Add commands in `commands/project.rs`:
   ```rust
   #[tauri::command]
   pub async fn list_projects(state: ...) -> Result<Vec<ProjectMeta>, String>

   #[tauri::command]
   pub async fn get_project(state: ..., project_id: String) -> Result<ProjectMeta, String>
   ```

**Frontend:**

2. Create `src/components/ProjectList.tsx`:
   - On mount: `invoke('list_projects')` → render list of project names + creation dates.
   - Clicking a project: `invoke('open_project', { projectId })` → if `copc_ready`, skip conversion, load hierarchy, render.
   - "New Project" button → `<FileOpen />`.

3. `App.tsx` shows `<ProjectList />` when no project is open, and `<Viewport />` when a project is active.

### Acceptance Test

- Open a project. Close the app. Reopen. Project appears in the list.
- Click the project. No PDAL conversion runs (no `conversion_progress` events fire).
- First points visible on screen < 3s from click (measure with `performance.now()`).

---

## Milestone 14: Multi-Viewport

**Goal:** Second camera (top-down orthographic view) rendered in the same R3F canvas via `gl.setScissor`. Both viewports maintain ≥ 60fps simultaneously.

### Dependencies

Milestone 12 complete.

### Steps

**Frontend:**

1. Create `src/components/MultiViewport.tsx`. Replace `<Viewport />` in `App.tsx` with `<MultiViewport />`.

2. Layout: main view (left, ~70% width) + top view (right, ~30% width). Implemented with `useFrame` and `gl.setScissor`:

   ```typescript
   useFrame(({ gl, scene }) => {
     const { width, height } = gl.domElement.getBoundingClientRect();
     const splitX = Math.floor(width * 0.7);

     // Main view (left panel)
     gl.setScissor(0, 0, splitX, height);
     gl.setViewport(0, 0, splitX, height);
     gl.setScissorTest(true);
     mainCamera.aspect = splitX / height;
     mainCamera.updateProjectionMatrix();
     gl.render(scene, mainCamera);

     // Top view (right panel)
     gl.setScissor(splitX, 0, width - splitX, height);
     gl.setViewport(splitX, 0, width - splitX, height);
     topCamera.position.set(0, 500, 0);  // survey scale — tune based on point cloud bbox
     topCamera.lookAt(0, 0, 0);
     topCamera.updateProjectionMatrix();
     gl.render(scene, topCamera);
   });
   ```

3. `OrbitControls` applies to `mainCamera` only. Top camera is fixed (top-down orthographic).

4. Set `frameloop="never"` on the R3F `<Canvas>` and call `gl.render` manually inside `useFrame` (as above) to prevent R3F's default auto-render from double-rendering.

### Acceptance Test

- Both viewports visible simultaneously, showing the same point cloud from different angles.
- Orbiting in the main view does not affect the top view camera.
- Stats panel shows ≥ 60fps with both viewports rendering.
- No visible seam or artifact at the scissor boundary.

---

## Performance Verification Checklist

Run this after all milestones are complete:

| Check | Method | Target |
|---|---|---|
| Sustained fps with 5M points | Stats panel during orbit | ≥ 60fps |
| First points visible (fresh open) | `performance.now()` log | < 3s |
| First points visible (reopen) | `performance.now()` log | < 3s |
| Node streaming latency | `performance.now()` in load queue | < 100ms after camera stops |
| IPC round-trip (1MB) | Benchmark in M5 | < 10ms |
| Main thread during decode | DevTools Performance tab | No long tasks |
| Point buffer memory cap | DevTools Memory | ≤ 60MB for positions (5M × 3 × 4B) |
| Both viewports fps | Stats panel | ≥ 60fps each |
