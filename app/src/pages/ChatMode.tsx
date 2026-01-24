import { useEffect, useState } from "react";
import { api } from "../api";

export const ChatModePage = () => {
  const [mode, setMode] = useState<string>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await api.getAppMode();
    setMode(res?.mode || "idle");
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setError(null);
        await api.setAppMode("chat");
        if (!cancelled) await refresh();
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to set chat mode");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const disable = async () => {
    try {
      setError(null);
      await api.setAppMode("idle");
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to disable chat mode");
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black">CHAT MODE</h2>
        <button type="button" className="retro-btn" onClick={disable}>
          Disable
        </button>
      </div>

      {error && <div className="retro-card font-mono text-sm mb-4">{error}</div>}

      <div className="retro-card">
        <div className="font-bold uppercase text-sm mb-2">Current mode</div>
        <div className="font-mono text-sm">{mode}</div>
        <div className="mt-4 text-sm text-gray-700">
          When Chat mode is enabled, the ESP32 device is allowed to connect.
        </div>
      </div>
    </div>
  );
};
