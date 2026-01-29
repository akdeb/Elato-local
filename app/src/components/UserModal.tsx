import { useEffect, useState } from "react";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { api } from "../api";
import { Modal } from "./Modal";
import { EmojiAvatar } from "./EmojiAvatar";
import { Pencil } from "lucide-react";

export type UserForModal = {
  id: string;
  name: string;
  age?: number | null;
  about_you?: string | null;
  user_type?: string | null;
  avatar_emoji?: string | null;
};

type UserModalProps = {
  open: boolean;
  mode: "create" | "edit";
  user?: UserForModal | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

export function UserModal({ open, mode, user, onClose, onSuccess }: UserModalProps) {
  const [name, setName] = useState("");
  const [age, setAge] = useState<string>("");
  const [aboutYou, setAboutYou] = useState("");
  const [userType, setUserType] = useState("family");
  const [avatarEmoji, setAvatarEmoji] = useState<string>("🙂");
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAge("");
    setAboutYou("");
    setUserType("family");
    setAvatarEmoji("🙂");
    setError(null);
  };

  useEffect(() => {
    if (!open) return;

    if (mode === "edit") {
      if (!user) {
        reset();
        return;
      }
      setName(user.name || "");
      setAge(user.age != null ? String(user.age) : "");
      setAboutYou((user.about_you || "") as string);
      setUserType(user.user_type || "family");
      setAvatarEmoji(user.avatar_emoji || "🙂");
      setError(null);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, user?.id]);

  const handleEmojiClick = (emoji: EmojiClickData) => {
    setAvatarEmoji(emoji.emoji);
    setShowPicker(false);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (mode === "edit" && !user) return;

    setSubmitting(true);
    setError(null);

    try {
      if (mode === "create") {
        await api.createUser({
          name: name.trim(),
          age: age ? Number(age) : null,
          about_you: aboutYou,
          user_type: userType,
          avatar_emoji: avatarEmoji,
        });
      } else {
        await api.updateUser(user!.id, {
          name: name.trim(),
          age: age ? Number(age) : null,
          about_you: aboutYou,
          user_type: userType,
          avatar_emoji: avatarEmoji,
        });
      }

      await onSuccess();
      reset();
      onClose();
    } catch (e: any) {
      setError(e?.message || (mode === "create" ? "Failed to create member" : "Failed to update member"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === "create" ? "Add Member" : "Edit Member"}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 font-mono">{error}</div>}

        <div className="flex items-end gap-4">
          <div className="relative">
            <button
              type="button"
              className="w-14 h-14 rounded-[16px] border border-gray-200 bg-white flex items-center justify-center"
              onClick={() => setShowPicker((v) => !v)}
              aria-label="Choose avatar emoji"
            >
              <EmojiAvatar emoji={avatarEmoji} size={28} />
            </button>
            <div onClick={() => setShowPicker((v) => !v)} className="absolute -bottom-1 -right-1 w-6 h-6 cursor-pointer rounded-full flex items-center justify-center text-[10px]">
              <Pencil size={12} className="text-gray-600" />
            </div>
            {showPicker && (
              <div className="absolute left-0 mt-2 z-50">
                <div className="bg-white border border-gray-200 rounded-[16px] shadow-[0_12px_28px_rgba(0,0,0,0.12)] p-2">
                  <EmojiPicker
                    onEmojiClick={handleEmojiClick}
                    height={320}
                    width={300}
                    lazyLoadEmojis
                    searchPlaceHolder="Search"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="block font-bold uppercase text-sm mb-2">Name</div>
            <input
              className="retro-input w-full"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "create" ? "e.g. Akash" : undefined}
            />
          </div>

          <div className="w-24">
            <div className="block font-bold uppercase text-sm mb-2">Age</div>
            <input
              className="retro-input w-full"
              value={age}
              maxLength={3}
              max={999}
              onChange={(e) => setAge(e.target.value)}
              placeholder={mode === "create" ? "Age" : undefined}
              inputMode="numeric"
            />
          </div>
        </div>

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">Member Type</label>
          <select className="retro-input" value={userType} onChange={(e) => setUserType(e.target.value)}>
            <option value="family">family</option>
            <option value="friend">friend</option>
            <option value="guest">guest</option>
          </select>
        </div>

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">About you</label>
          <textarea
            className="retro-input"
            rows={3}
            value={aboutYou}
            maxLength={1000}
            onChange={(e) => setAboutYou(e.target.value)}
            placeholder={mode === "create" ? "A short note about you" : undefined}
          />
        </div>

        <div className="flex justify-end">
          <button className="retro-btn" type="button" onClick={submit} disabled={submitting}>
            {mode === "create" ? (submitting ? "Creating…" : "Create Member") : submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
