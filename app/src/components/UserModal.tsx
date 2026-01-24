import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";

export type UserForModal = {
  id: string;
  name: string;
  age?: number | null;
  about_you?: string | null;
  user_type?: string | null;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAge("");
    setAboutYou("");
    setUserType("family");
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
      setError(null);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, user?.id]);

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
        });
      } else {
        await api.updateUser(user!.id, {
          name: name.trim(),
          age: age ? Number(age) : null,
          about_you: aboutYou,
          user_type: userType,
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
        {error && <div className="font-mono text-sm">{error}</div>}

        <div>
          <label className="block font-bold mb-2 uppercase text-sm">Name</label>
          <input
            className="retro-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={mode === "create" ? "e.g. Akash" : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-bold mb-2 uppercase text-sm">Age</label>
            <input
              className="retro-input"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder={mode === "create" ? "e.g. 8" : undefined}
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
