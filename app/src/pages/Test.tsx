import { useEffect, useMemo } from "react";
import { useVoiceWs } from "../state/VoiceWsContext";

export const TestPage = () => {
  const voiceWs = useVoiceWs();

  useEffect(() => {
    if (!voiceWs.isActive) {
      voiceWs.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusDotClass =
    voiceWs.status === "connected"
      ? "bg-[#00c853]"
      : voiceWs.status === "error"
        ? "bg-red-500"
        : "bg-[#ffd400]";

  const micStatusLabel = useMemo(() => {
    if (voiceWs.isSpeaking) return "speaking";
    if (!voiceWs.isRecording) return voiceWs.status === "connected" ? "waiting" : null;
    if (voiceWs.isPaused) return "processing";
    return "listening";
  }, [voiceWs.isRecording, voiceWs.isPaused, voiceWs.isSpeaking, voiceWs.status]);

  const orbScale = useMemo(() => {
    const base = voiceWs.isRecording ? 1.03 : 1;
    const mic = voiceWs.isRecording && !voiceWs.isPaused ? voiceWs.micLevel * 0.18 : 0;
    const speak = voiceWs.isSpeaking ? 0.08 : 0;
    return base + mic + speak;
  }, [voiceWs.isRecording, voiceWs.isPaused, voiceWs.micLevel, voiceWs.isSpeaking]);

  return (
    <div>
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-3xl font-black">LIVE</h2>
          <div className="mt-2 font-mono text-xs text-gray-600">
            Character: <span className="font-bold text-black">{voiceWs.characterName}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-gray-600 inline-flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full border border-black ${statusDotClass}`} />
            <span className="capitalize">{voiceWs.status}</span>
            {micStatusLabel && (
              <span className="text-gray-500">
                • {micStatusLabel}
              </span>
            )}
          </div>
          {voiceWs.error && <div className="mt-3 font-mono text-xs text-red-700">{voiceWs.error}</div>}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center py-16">
        <div
          className="rounded-full border-2 border-black shadow-[0_14px_30px_rgba(0,0,0,0.18)] bg-[#9b5cff] transition-shadow"
          aria-hidden
          style={{
            width: 148,
            height: 148,
            transform: `scale(${orbScale})`,
            transition: "transform 80ms linear",
            opacity: voiceWs.status === "connected" ? 1 : 0.7,
          }}
        />

        <div className="mt-8 font-mono text-xs text-gray-600 text-center">
          {voiceWs.status === "connecting" && "Connecting…"}
          {voiceWs.status === "error" && "WebSocket error"}
          {voiceWs.status === "disconnected" && "Disconnected"}
          {voiceWs.status === "connected" && "Live"}
        </div>
      </div>
    </div>
  );
};
