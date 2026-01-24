import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Loader2,
  CheckCircle2,
  Download,
  Mic,
  Volume2,
  AlertCircle,
  Brain,
} from "lucide-react";

interface ModelInfo {
  id: string;
  name: string;
  model_type: string;
  repo_id: string;
  downloaded: boolean;
  size_estimate: string | null;
}

interface ModelStatus {
  models: ModelInfo[];
  all_downloaded: boolean;
}

interface LocalModelInfo {
  id: string;
  name: string;
  model_type: string;
  repo_id: string;
  downloaded: boolean;
  size_estimate: string | null;
}

export const ModelSetupPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [selectedLlmRepoId, setSelectedLlmRepoId] = useState<string>("");
  const [savingLlm, setSavingLlm] = useState(false);

  useEffect(() => {
    const unlisten = listen<string>("model-download-progress", (event) => {
      setProgress(event.payload);
    });

    checkModels();
    refreshLocalModels();
    loadSelectedLlm();

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const refreshLocalModels = async () => {
    try {
      const result = await invoke<LocalModelInfo[]>("scan_local_models");
      setLocalModels(result);
    } catch (e: any) {
      // Non-fatal; keep page usable
      console.warn("Failed to scan local models:", e);
    }
  };

  const loadSelectedLlm = async () => {
    try {
      // Uses the Python sidecar settings endpoint
      const res = await fetch("http://127.0.0.1:8000/settings/llm_model").then((r) => r.json());
      if (typeof res?.value === "string") {
        setSelectedLlmRepoId(res.value);
      }
    } catch (e) {
      // ignore
    }
  };

  const saveSelectedLlm = async (repoId: string) => {
    try {
      setSavingLlm(true);
      setError(null);
      await fetch("http://127.0.0.1:8000/settings/llm_model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: repoId || null }),
      });
      setSelectedLlmRepoId(repoId);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSavingLlm(false);
    }
  };

  const checkModels = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<ModelStatus>("check_models_status");
      setModelStatus(result);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadModel = async (repoId: string) => {
    try {
      setDownloading(repoId);
      setError(null);
      setProgress(`Downloading ${repoId}...`);
      await invoke("download_model", { repoId });
      await checkModels();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloading(null);
      setProgress("");
    }
  };

  const downloadAllModels = async () => {
    try {
      setDownloadingAll(true);
      setError(null);
      await invoke("download_all_models");
      await checkModels();
      await refreshLocalModels();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloadingAll(false);
      setProgress("");
    }
  };

  const handleContinue = async () => {
    try {
      setProgress("Starting Local AI Engine...");
      await invoke("start_backend");
      await invoke("mark_setup_complete");
      setError(null);
      navigate("/", { replace: true });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setProgress("");
    }
  };

  const getModelIcon = (modelType: string) => {
    switch (modelType) {
      case "stt":
        return <Mic className="w-5 h-5" />;
      case "llm":
        return <Brain className="w-5 h-5" />;
      case "tts":
        return <Volume2 className="w-5 h-5" />;
      default:
        return <Download className="w-5 h-5" />;
    }
  };

  const getModelTypeLabel = (modelType: string) => {
    switch (modelType) {
      case "stt":
        return "Speech-to-Text";
      case "llm":
        return "Language Model";
      case "tts":
        return "Text-to-Speech";
      default:
        return modelType.toUpperCase();
    }
  };

  const pendingModels = modelStatus?.models.filter((m) => !m.downloaded) || [];
  const allDownloaded = modelStatus?.all_downloaded ?? false;

  const localLlms = localModels
    .filter((m) => m.model_type === "llm")
    .sort((a, b) => a.repo_id.localeCompare(b.repo_id));

  return (
    <div className="min-h-screen bg-[var(--color-retro-bg)] retro-dots flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black mb-2 tracking-wider brand-font">AI MODELS</h1>
          <p className="text-gray-600 font-mono">Download the required models to get started</p>
        </div>

        <div className="retro-card">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="mb-6 bg-white border border-black rounded-xl p-4 retro-shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-bold uppercase text-xs tracking-wider">
                    <Brain className="w-4 h-4" />
                    Selected LLM (Local)
                  </div>
                  <button className="retro-btn text-xs py-1.5 px-3" onClick={refreshLocalModels} disabled={savingLlm}>
                    Refresh
                  </button>
                </div>

                <div className="mt-3">
                  <select
                    className="retro-input"
                    value={selectedLlmRepoId}
                    onChange={(e) => saveSelectedLlm(e.target.value)}
                    disabled={savingLlm}
                  >
                    <option value="">(default)</option>
                    {localLlms.map((m) => (
                      <option key={m.repo_id} value={m.repo_id}>
                        {m.repo_id}{m.size_estimate ? ` (${m.size_estimate})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 text-[11px] font-mono text-gray-500">
                    This dropdown is generated from your local HuggingFace cache.
                    Changes are saved to settings and will take effect on next server restart.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {modelStatus?.models.map((model) => (
                  <div
                    key={model.id}
                    className="bg-white border border-black rounded-xl p-4 flex items-center gap-4 retro-shadow-sm transition-all hover:translate-y-[-2px]"
                  >
                    <div
                      className={`p-2 rounded-lg border border-black ${
                        model.downloaded ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {getModelIcon(model.model_type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">{model.name}</div>
                      <div className="text-xs text-gray-500 uppercase tracking-wider font-bold mt-0.5">
                        {getModelTypeLabel(model.model_type)}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400 truncate mt-1 bg-gray-50 px-1.5 py-0.5 rounded inline-block">
                        {model.repo_id}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {model.size_estimate && (
                        <span className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded-full border border-gray-100">
                          {model.size_estimate}
                        </span>
                      )}

                      {model.downloaded ? (
                        <div className="flex items-center gap-1 text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wide">Ready</span>
                        </div>
                      ) : downloading === model.repo_id || downloadingAll ? (
                        <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-200">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-xs font-bold uppercase tracking-wide">Downloading</span>
                        </div>
                      ) : (
                        <button
                          className="retro-btn text-xs py-1.5 px-4"
                          onClick={() => downloadModel(model.repo_id)}
                          disabled={!!downloading || downloadingAll}
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {progress && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <div className="text-sm text-blue-700 font-mono">{progress}</div>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-700 font-mono break-all">{error}</div>
                </div>
              )}

              <div className="mt-8 flex gap-3 border-t-2 border-black pt-6">
                {!allDownloaded && pendingModels.length > 0 && (
                  <button
                    className="retro-btn flex-1 flex items-center justify-center gap-2"
                    onClick={downloadAllModels}
                    disabled={!!downloading || downloadingAll}
                  >
                    {downloadingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Downloading All...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Download All ({pendingModels.length})
                      </>
                    )}
                  </button>
                )}

                {allDownloaded && (
                  <button className="retro-btn retro-btn-green flex-1 flex items-center justify-center gap-2" onClick={handleContinue}>
                    Continue to App →
                  </button>
                )}
              </div>

              {!allDownloaded && (
                <div className="mt-4 text-center">
                  <button
                    className="text-xs font-mono text-gray-500 underline hover:text-gray-800 transition-colors"
                    onClick={handleContinue}
                  >
                    Skip for now (download later)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-gray-500 font-mono opacity-60">
          Models are downloaded from HuggingFace Hub and cached locally in ~/.cache/huggingface/hub
        </div>
      </div>
    </div>
  );
};
