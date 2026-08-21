import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type AudienceMode = "kid" | "adult";

/** Backend setting key. The prompt builder reads the same key server-side. */
export const AUDIENCE_MODE_SETTING = "audience_mode";

const STORAGE_KEY = "elato.audienceMode";

/**
 * Guarded by default. The device gets handed to a child far more often than it
 * gets reconfigured, so an install that has never visited Settings must not
 * start in the permissive mode.
 */
export const DEFAULT_AUDIENCE_MODE: AudienceMode = "kid";

export const normalizeAudienceMode = (value: unknown): AudienceMode =>
  String(value ?? "").trim().toLowerCase() === "adult" ? "adult" : "kid";

type AudienceModeContextValue = {
  mode: AudienceMode;
  isKid: boolean;
  setMode: (mode: AudienceMode) => Promise<void>;
  /** False until the stored value has been read, so Settings can avoid flicker. */
  loaded: boolean;
};

const AudienceModeContext = createContext<AudienceModeContextValue | null>(null);

/**
 * Kid mode restores the pre-redesign playful theme via `body.kid-mode`, which
 * App.css scopes the old design tokens under. Adult mode is the default flat
 * theme, so it carries no class.
 */
const applyBodyClass = (mode: AudienceMode) => {
  document.body.classList.toggle("kid-mode", mode === "kid");
};

export function AudienceModeProvider({ children }: { children: React.ReactNode }) {
  // Seed from localStorage so the correct theme paints on the first frame -
  // the server round-trip below would otherwise flash the wrong UI.
  const [mode, setModeState] = useState<AudienceMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeAudienceMode(stored) : DEFAULT_AUDIENCE_MODE;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    applyBodyClass(mode);
  }, [mode]);

  const setMode = useCallback(async (next: AudienceMode) => {
    const normalized = normalizeAudienceMode(next);
    setModeState(normalized);
    localStorage.setItem(STORAGE_KEY, normalized);
    try {
      await api.setSetting(AUDIENCE_MODE_SETTING, normalized);
    } catch {
      // Theme still switches locally; the backend keeps the previous prompt
      // mode until a later write succeeds.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const res = await api.getSetting(AUDIENCE_MODE_SETTING).catch(() => null);
      if (cancelled) return;

      const stored = res?.value;
      if (stored) {
        const normalized = normalizeAudienceMode(stored);
        setModeState(normalized);
        localStorage.setItem(STORAGE_KEY, normalized);
      } else {
        // Never configured: write the default so the backend prompt builder and
        // the UI agree from the very first session.
        await api.setSetting(AUDIENCE_MODE_SETTING, DEFAULT_AUDIENCE_MODE).catch(() => null);
        if (cancelled) return;
        localStorage.setItem(STORAGE_KEY, DEFAULT_AUDIENCE_MODE);
      }
      setLoaded(true);
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ mode, isKid: mode === "kid", setMode, loaded }),
    [mode, setMode, loaded]
  );

  return (
    <AudienceModeContext.Provider value={value}>{children}</AudienceModeContext.Provider>
  );
}

export function useAudienceMode() {
  const ctx = useContext(AudienceModeContext);
  if (!ctx) throw new Error("useAudienceMode must be used within AudienceModeProvider");
  return ctx;
}
