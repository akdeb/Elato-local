import { useEffect, useState } from "react";
import { api } from "../api";

export const ModelsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [current, setCurrent] = useState<any>(null);
  const [modelRepo, setModelRepo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setError(null);
        const data = await api.getModels();
        if (!cancelled) {
          setCurrent(data);
          setModelRepo(data?.llm?.repo || "");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load models");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const data = await api.setModels({ model_repo: modelRepo });
      setCurrent(data);
    } catch (e: any) {
      setError(e?.message || "Failed to save models");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black">AI MODELS</h2>
        <button type="button" className="retro-btn" onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading && <div className="retro-card font-mono text-sm mb-4">Loading…</div>}
      {error && <div className="retro-card font-mono text-sm mb-4">{error}</div>}

      <div className="retro-card mb-4">
        <div className="font-bold uppercase text-sm mb-3">Current runtime</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-black rounded-[18px] px-4 py-3 retro-shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider">LLM</div>
            <div className="font-mono text-xs text-gray-700 mt-1">Backend: {current?.llm?.backend || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1 break-all">Repo: {current?.llm?.repo || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1 break-all">File: {current?.llm?.file || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1">Ctx: {current?.llm?.context_window || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1">Loaded: {current?.llm?.loaded ? "yes" : "no"}</div>
          </div>

          <div className="bg-white border border-black rounded-[18px] px-4 py-3 retro-shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider">TTS</div>
            <div className="font-mono text-xs text-gray-700 mt-1">Backend: {current?.tts?.backend || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1 break-all">Backbone: {current?.tts?.backbone_repo || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1 break-all">Codec: {current?.tts?.codec_repo || "—"}</div>
            <div className="font-mono text-xs text-gray-700 mt-1">Loaded: {current?.tts?.loaded ? "yes" : "no"}</div>
          </div>
        </div>
      </div>

      <div className="retro-card">
        <div className="font-bold uppercase text-sm mb-3">Bring your own model</div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <div className="font-bold uppercase text-xs mb-1">HF repo</div>
            <input className="retro-input w-full" value={modelRepo} onChange={(e) => setModelRepo(e.target.value)} />
            <div className="text-[10px] font-mono text-gray-500 mt-1">
              Example: hugging-quants/Llama-3.2-3B-Instruct-Q4_K_M-GGUF
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-black rounded-[18px] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wider">RAM estimate</div>
            <div className="font-mono text-xs text-gray-600 mt-1">(placeholder)</div>
          </div>
          <div className="bg-white border border-black rounded-[18px] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wider">GPU / Metal</div>
            <div className="font-mono text-xs text-gray-600 mt-1">(placeholder)</div>
          </div>
          <div className="bg-white border border-black rounded-[18px] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wider">Context window</div>
            <div className="font-mono text-xs text-gray-600 mt-1">(placeholder)</div>
          </div>
        </div>
      </div>
    </div>
  );
};
