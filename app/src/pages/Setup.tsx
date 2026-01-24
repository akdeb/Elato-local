import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, CheckCircle2, XCircle, Download } from "lucide-react";

interface SetupStatus {
  python_installed: boolean;
  python_version: string | null;
  python_path: string | null;
  venv_exists: boolean;
  venv_path: string | null;
  deps_installed: boolean;
}

type SetupStep = "checking" | "creating-venv" | "installing-deps" | "complete";

export const SetupPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<SetupStep>("checking");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("setup-progress", (event) => {
      setProgress(event.payload);
    });

    checkStatus();

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const checkStatus = async () => {
    try {
      setStep("checking");
      setError(null);
      const result = await invoke<SetupStatus>("check_setup_status");
      setStatus(result);

      if (result.deps_installed) {
        setStep("complete");
      } else if (result.venv_exists) {
        setStep("installing-deps");
        await installDeps();
      } else {
        await runFullSetup();
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const runFullSetup = async () => {
    try {
      setError(null);
      setStep("creating-venv");
      setProgress("Using bundled Python runtime...");
      await invoke("create_python_venv");

      setStep("installing-deps");
      setProgress("Installing dependencies...");
      await invoke("install_python_deps");

      setStep("complete");
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const installDeps = async () => {
    try {
      setError(null);
      setProgress("Installing dependencies...");
      await invoke("install_python_deps");

      setStep("complete");
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleContinue = () => {
    navigate("/model-setup", { replace: true });
  };

  const renderStepIndicator = (
    label: string,
    isActive: boolean,
    isComplete: boolean,
    isFailed: boolean
  ) => (
    <div className="flex items-center gap-3 py-2">
      {isFailed ? (
        <XCircle className="w-5 h-5 text-red-500" />
      ) : isComplete ? (
        <CheckCircle2 className="w-5 h-5 text-green-600" />
      ) : isActive ? (
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
      )}
      <span
        className={`font-medium ${
          isActive ? "text-blue-600" : isComplete ? "text-green-600" : "text-gray-500"
        }`}
      >
        {label}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--color-retro-bg)] retro-dots flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black mb-2 tracking-wider brand-font">EPIC LOCAL AI TOYS</h1>
          <p className="text-gray-600 font-mono">Let's set up your local AI engine</p>
        </div>

        <div className="retro-card">
          <div className="font-bold uppercase text-sm mb-4 flex items-center gap-2 border-b-2 border-black pb-2">
            <Download className="w-4 h-4" />
            Environment Setup
          </div>

          <div className="space-y-2">
            {renderStepIndicator(
                "Create virtual environment",
                step === "checking" || step === "creating-venv",
                (status?.venv_exists || step === "installing-deps" || step === "complete") ?? false,
                false
              )}
            {status?.python_version && (
              <div className="ml-8 text-xs text-gray-500 font-mono -mt-1 mb-2">
                {status.python_version}
              </div>
            )}
              {renderStepIndicator(
                "Install dependencies",
                step === "installing-deps",
                (status?.deps_installed || step === "complete") ?? false,
                !!error && step === "installing-deps"
              )}

              {progress && step !== "complete" && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-sm text-blue-700 font-mono">{progress}</div>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <div className="text-sm text-red-700 font-mono break-all">{error}</div>
                  <button className="retro-btn mt-3" onClick={checkStatus}>
                    Retry
                  </button>
                </div>
              )}

              {step === "complete" && (
                <div className="mt-6 space-y-4">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                    <div className="text-sm text-green-700 font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Environment setup complete!
                    </div>
                  </div>
                  <button className="retro-btn w-full" onClick={handleContinue}>
                    Continue to Model Setup →
                  </button>
                </div>
              )}
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500 font-mono opacity-60">
          This will install MLX, Transformers, Numpy and other AI dependencies
        </div>
      </div>
    </div>
  );
};
