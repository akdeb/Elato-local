import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";
import { ArrowUp } from "lucide-react";
import logoPng from '../assets/logo.png';

type ExperienceType = 'personality' | 'game' | 'story';

export type ExperienceForModal = {
  id: string;
  name: string;
  prompt: string;
  short_description: string;
  voice_id: string;
  type: ExperienceType;
  is_visible: boolean;
};

type ExperienceModalProps = {
  open: boolean;
  mode: "create" | "edit";
  experience?: ExperienceForModal | null;
  experienceType: ExperienceType;
  createVoiceId?: string | null;
  createVoiceName?: string | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const TYPE_LABELS: Record<ExperienceType, { singular: string; placeholder: string }> = {
  personality: {
    singular: 'Character',
    placeholder: "Describe the character you'd like to create...",
  },
  game: {
    singular: 'Game',
    placeholder: "Describe the game experience you'd like to create...",
  },
  story: {
    singular: 'Story',
    placeholder: "Describe the story experience you'd like to create...",
  },
};

export function ExperienceModal({
  open,
  mode,
  experience,
  experienceType,
  createVoiceId,
  createVoiceName,
  onClose,
  onSuccess,
}: ExperienceModalProps) {
  // Create mode state
  const [description, setDescription] = useState("");
  
  // Edit mode state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [voiceId, setVoiceId] = useState("radio");
  const [voices, setVoices] = useState<any[]>([]);
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = TYPE_LABELS[experienceType];

  const reset = () => {
    setDescription("");
    setName("");
    setPrompt("");
    setShortDescription("");
    setVoiceId("radio");
    setError(null);
  };

  useEffect(() => {
    if (!open) return;

    if (mode === "edit") {
      if (!experience) {
        reset();
        return;
      }
      setName(experience.name || "");
      setPrompt(experience.prompt || "");
      setShortDescription(experience.short_description || "");
      setVoiceId(experience.voice_id || "radio");
      setError(null);
    } else {
      reset();
    }
  }, [open, mode, experience?.id]);

  useEffect(() => {
    if (!open) return;
    if (mode !== "edit") return;
    let cancelled = false;

    const loadVoices = async () => {
      try {
        const data = await api.getVoices();
        if (!cancelled) setVoices(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setVoices([]);
      }
    };

    loadVoices();
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  const submitCreate = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const descriptionWithFormatGuard = `${description.trim()}\n\nReturn plain text only. Do not use markdown or asterisks.`;
      await api.generateExperience(
        descriptionWithFormatGuard,
        experienceType,
        createVoiceId || undefined
      );
      await onSuccess();
      reset();
      onClose();
    } catch (e: any) {
      setError(e?.message || `Failed to generate ${labels.singular.toLowerCase()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        prompt: prompt.trim(),
        short_description: shortDescription.trim(),
        voice_id: voiceId,
      };

      if (experience) {
        await api.updateExperience(experience.id, payload);
      }

      await onSuccess();
      reset();
      onClose();
    } catch (e: any) {
      setError(e?.message || `Failed to update ${labels.singular.toLowerCase()}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "create") {
    return (
      <Modal
        open={open}
        title={""}
        onClose={() => {
          reset();
          onClose();
        }}
      >
        <div className="space-y-6 text-center">
            {error && <div className="font-mono text-sm text-red-600 mb-2">{error}</div>}
            
            <div className="flex flex-col items-center gap-2 mb-6">
                <div className="rounded-full">
                     <img src={logoPng} alt="" className="w-10 h-10" />
                </div>
                <h3 className="font-black text-2xl uppercase mt-2">Create Your {labels.singular}</h3>
                {createVoiceId && (
                  <div className="font-mono text-xs text-gray-700">
                    Create with {createVoiceName || createVoiceId}
                  </div>
                )}
            </div>

            <div className="relative w-full">
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={labels.placeholder}
                    className="w-full min-h-[120px] p-4 pr-14 rounded-[20px] border-2 border-black resize-none text-lg bg-white focus:outline-none shadow-inner placeholder:text-gray-500"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            submitCreate();
                        }
                    }}
                />
                <button 
                    onClick={submitCreate}
                    disabled={submitting || !description.trim()}
                    className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${(!submitting && !!description.trim()) ? 'cursor-pointer bg-[#9b5cff] text-white border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:brightness-105 hover:scale-[1.03] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:scale-[0.98] active:translate-x-0 active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white' : 'bg-gray-200 text-gray-700 border-transparent hover:border-black'}`}
                >
                    {submitting ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <ArrowUp className="w-5 h-5" />
                    )}
                </button>
            </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={`Edit ${labels.singular}`}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <div className="space-y-4">
        {error && <div className="font-mono text-sm text-red-600">{error}</div>}

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">Name</label>
          <input
            className="retro-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Helpful Assistant"
          />
        </div>

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">System Prompt</label>
          <textarea
            className="retro-input min-h-[100px]"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="You are a helpful AI assistant..."
          />
        </div>

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">Short Description</label>
          <input
            className="retro-input"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            placeholder="e.g. A general purpose assistant"
          />
        </div>

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">Voice ID</label>
          <select className="retro-input" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {!voices.some((v) => v?.voice_id === voiceId) && (
              <option value={voiceId}>{voiceId}</option>
            )}
            {voices
              .slice()
              .sort((a, b) => String(a?.voice_name || a?.voice_id || "").localeCompare(String(b?.voice_name || b?.voice_id || "")))
              .map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.voice_name || v.voice_id}
                </option>
              ))}
          </select>
        </div>

        <div className="flex justify-end">
          <button className="retro-btn" type="button" onClick={submitEdit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
