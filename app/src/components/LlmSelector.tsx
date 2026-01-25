import { useEffect, useMemo, useState } from "react";
import llms from "../assets/llms.json";

export type LlmOption = {
  id: string;
  name: string;
  repo_id: string;
  params: string;
  quantization: string;
  specialty: string;
  thinking?: boolean;
};

type Props = {
  value: string;
  onChange: (repoId: string) => void;
  disabled?: boolean;
  label?: string;
};

const OPTIONS = llms as LlmOption[];

export const LlmSelector = ({ value, onChange, disabled, label = "Model" }: Props) => {
  const presetMatch = useMemo(
    () => OPTIONS.find((opt) => opt.repo_id === value),
    [value]
  );
  const [mode, setMode] = useState<"preset" | "custom">(presetMatch ? "preset" : "custom");
  const [customRepo, setCustomRepo] = useState(presetMatch ? "" : value);

  useEffect(() => {
    const match = OPTIONS.find((opt) => opt.repo_id === value);
    setMode(match ? "preset" : "custom");
    if (!match) {
      setCustomRepo(value);
    }
  }, [value]);

  const selectedInfo = presetMatch || OPTIONS.find((opt) => opt.repo_id === customRepo);

  return (
    <div className="space-y-2">
      {label ? (
        <label className="font-bold mb-2 uppercase text-xs opacity-40">{label}</label>
      ) : null}
      <div className="flex gap-2">
        <select
          className="retro-input bg-white flex-1"
          value={mode === "preset" ? presetMatch?.repo_id || "" : "__custom__"}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "__custom__") {
              setMode("custom");
              if (customRepo) {
                onChange(customRepo);
              }
              return;
            }
            setMode("preset");
            onChange(next);
          }}
          disabled={disabled}
        >
          <option value="" disabled>
            Select a model…
          </option>
          {OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.repo_id}>
              {opt.name}
            </option>
          ))}
          <option value="__custom__">Custom repo…</option>
        </select>
      </div>

      {mode === "custom" && (
        <input
          type="text"
          value={customRepo}
          onChange={(e) => {
            const next = e.target.value.trim();
            setCustomRepo(next);
            onChange(next);
          }}
          placeholder="e.g. mlx-community/Qwen3-4B-4bit"
          className="retro-input bg-white w-full"
          disabled={disabled}
        />
      )}

      {selectedInfo && (
        <div className="text-[10px] font-mono text-gray-500">
          {selectedInfo.params} · {selectedInfo.quantization} · {selectedInfo.specialty}
        </div>
      )}
    </div>
  );
};
