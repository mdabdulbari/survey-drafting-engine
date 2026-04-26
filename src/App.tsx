import { useState } from "react";
import { openProject, startConversion } from "./ipc/commands";
import { loadCopc } from "./lib/copc-reader";
import { usePointCloudStore } from "./store/pointCloudStore";
import { MultiViewport } from "./components/MultiViewport";
import { ConversionProgress } from "./components/ConversionProgress";
import { Launcher } from "./components/launcher/Launcher";
import { HUD } from "./components/HUD";
import { BenchmarkIPC } from "./components/BenchmarkIPC";
import { Overlay } from "./components/ui/Overlay";
import type { AppPhase } from "./types";
import type { ProjectMeta } from "./ipc/types";

function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [phase, setPhase] = useState<AppPhase>("launcher");

  function handleProjectCreated(id: string) {
    setProjectId(id);
    setPhase("converting");
  }

  async function handleConversionDone() {
    if (!projectId) return;
    try {
      const meta = await openProject(projectId);
      setProject(meta);
      await loadCopc(projectId);
      setPhase("ready");
    } catch (err) {
      console.error("Failed to open project after conversion:", err);
    }
  }

  function handleBackToLauncher() {
    usePointCloudStore.getState().reset();
    setProject(null);
    setProjectId(null);
    setPhase("launcher");
  }

  async function handleOpenExisting(p: ProjectMeta) {
    try {
      usePointCloudStore.getState().reset();
      const meta = await openProject(p.id);
      setProject(meta);
      setProjectId(meta.id);

      if (meta.copc_ready) {
        await loadCopc(meta.id);
        setPhase("ready");
      } else {
        setPhase("converting");
        startConversion(meta.id).catch((err) =>
          console.error("convert_to_copc error:", err),
        );
      }
    } catch (err) {
      console.error("Failed to open existing project:", err);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (phase === "launcher") {
    return (
      <Launcher
        onOpenProject={handleOpenExisting}
        onProjectCreated={handleProjectCreated}
      />
    );
  }

  return (
    <div className="relative w-screen h-screen">
      <MultiViewport />

      {phase === "converting" && projectId && (
        <Overlay>
          <ConversionProgress projectId={projectId} onDone={handleConversionDone} />
        </Overlay>
      )}

      {phase === "ready" && project && (
        <>
          <HUD project={project} onBack={handleBackToLauncher} />
          {/* TODO: remove BenchmarkIPC once M5 acceptance test passes */}
          <BenchmarkIPC projectId={project.id} />
        </>
      )}
    </div>
  );
}

export default App;
