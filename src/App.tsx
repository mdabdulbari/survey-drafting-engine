import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject, openProject, startConversion } from "./ipc/commands";
import { loadCopc } from "./lib/copc-reader";
import { usePointCloudStore } from "./store/pointCloudStore";
import { MultiViewport } from "./components/MultiViewport";
import { ConversionProgress } from "./components/ConversionProgress";
import { Launcher } from "./components/launcher/Launcher";
import { HUD } from "./components/HUD";
import { BenchmarkIPC } from "./components/BenchmarkIPC";
import { Overlay } from "./components/ui/Overlay";
import { TitleBar } from "./components/chrome/TitleBar";
import { useWindowState } from "./hooks/useWindowState";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import type { AppPhase } from "./types";
import type { ProjectMeta } from "./ipc/types";

function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [phase, setPhase] = useState<AppPhase>("launcher");

  // Window state lives at App so global shortcuts (F11) can target it.
  const win = useWindowState();

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

  const handleBackToLauncher = useCallback(() => {
    usePointCloudStore.getState().reset();
    setProject(null);
    setProjectId(null);
    setPhase("launcher");
  }, []);

  const handleOpenExisting = useCallback(async (p: ProjectMeta) => {
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
  }, []);

  // Lifted from NewProjectButton so the AppMenu can also trigger it.
  const handleNewProject = useCallback(async () => {
    try {
      const filePath = await open({
        multiple: false,
        filters: [{ name: "LAZ Files", extensions: ["laz"] }],
      });
      if (!filePath) return;
      const path = filePath as string;
      const name = path.split(/[\\/]/).pop() ?? "Untitled";
      const id = await createProject(name, path);
      handleProjectCreated(id);
      startConversion(id).catch((err) =>
        console.error("convert_to_copc error:", err),
      );
    } catch (err) {
      console.error("New project failed:", err);
    }
  }, []);

  useGlobalShortcuts({
    onToggleFullscreen: win.toggleFullscreen,
    onNewProject: phase === "launcher" ? handleNewProject : undefined,
    onReload: () => window.location.reload(),
  });

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070a13] text-slate-100 overflow-hidden">
      <TitleBar
        phase={phase}
        project={project}
        onBackToLauncher={handleBackToLauncher}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenExisting}
      />

      <div className="flex-1 relative min-h-0">
        {phase === "launcher" && (
          <Launcher
            onOpenProject={handleOpenExisting}
            onProjectCreated={handleProjectCreated}
          />
        )}

        {phase !== "launcher" && (
          <>
            <MultiViewport />

            {phase === "converting" && projectId && (
              <Overlay>
                <ConversionProgress
                  projectId={projectId}
                  onDone={handleConversionDone}
                />
              </Overlay>
            )}

            {phase === "ready" && project && (
              <>
                <HUD project={project} />
                {/* TODO: remove BenchmarkIPC once M5 acceptance test passes */}
                <BenchmarkIPC projectId={project.id} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
