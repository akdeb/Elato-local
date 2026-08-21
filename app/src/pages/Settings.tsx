import { useEffect, useState } from 'react';
import { api } from '../api';
import { RefreshCw, Brain, Radio, MonitorUp, Rss, Zap, Mic, Network, ShieldCheck, Package } from 'lucide-react';
import { useAudienceMode, type AudienceMode } from '../state/AudienceModeContext';
import { ModelSwitchModal } from '../components/ModelSwitchModal';
import { LlmSelector } from '../components/LlmSelector';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type ModelConfig = {
  llm: {
    backend: string;
    repo: string;
    file: string | null;
    loaded: boolean;
  };
  tts: {
    backend: string;
    loaded: boolean;
  };
};

type SystemProfile = {
  chip: string;
  model_identifier: string | null;
  total_memory_gb: number | null;
  arch: string;
};

const TTS_OPTIONS: Array<{
  id: 'chatterbox-turbo' | 'qwen3-tts';
  name: string;
  ramGb: number;
  diskGb: number;
  quality: string;
  note: string;
}> = [
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS 4bit',
    ramGb: 4,
    diskGb: 2,
    quality: 'Balanced',
    note: 'Best default for most Apple Silicon Macs',
  },
  {
    id: 'chatterbox-turbo',
    name: 'Chatterbox Turbo',
    ramGb: 6,
    diskGb: 4,
    quality: 'Expressive',
    note: 'Great style/expressivity, usually heavier',
  },
];

type DepsProgress = {
  step: number;
  steps: number;
  phase: 'downloading' | 'installing' | 'done';
  package: string;
  downloaded: number;
  total: number | null;
};

const formatElapsed = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
};

const AUDIENCE_OPTIONS: Array<{ id: AudienceMode; name: string; blurb: string }> = [
  {
    id: 'kid',
    name: 'For Kids',
    blurb: 'Age-appropriate replies with child-safety guardrails, and the playful toy interface.',
  },
  {
    id: 'adult',
    name: 'For Adults',
    blurb: 'Normal assistant behaviour without the child guardrails, and the full workbench interface.',
  },
];

export const Settings = () => {
  const { mode: audienceMode, setMode: setAudienceMode, loaded: audienceLoaded } = useAudienceMode();
  const [models, setModels] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [llmRepo, setLlmRepo] = useState('');
  const [ttsBackend, setTtsBackend] = useState<'chatterbox-turbo' | 'qwen3-tts'>('qwen3-tts');
  const [savingTts, setSavingTts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [flashing, setFlashing] = useState(false);
  const [flashLog, setFlashLog] = useState<string>('');
  const [laptopVolume, setLaptopVolume] = useState<number>(70);
  const [permissionFeedback, setPermissionFeedback] = useState<string | null>(null);
  const [openingPermission, setOpeningPermission] = useState<'microphone' | 'local-network' | null>(null);
  const [requestingPermission, setRequestingPermission] = useState<'microphone' | 'local-network' | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [localNetworkRequested, setLocalNetworkRequested] = useState(false);
  const [systemProfile, setSystemProfile] = useState<SystemProfile | null>(null);
  const [updatingDeps, setUpdatingDeps] = useState(false);
  const [depsProgress, setDepsProgress] = useState<DepsProgress | null>(null);
  const [depsStatus, setDepsStatus] = useState<string | null>(null);
  const [depsError, setDepsError] = useState<string | null>(null);
  const [depsElapsed, setDepsElapsed] = useState(0);

  // Model switch modal state
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [switchStage, setSwitchStage] = useState<'downloading' | 'loading' | 'complete' | 'error'>('downloading');
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switchMessage, setSwitchMessage] = useState('');
  const [switchError, setSwitchError] = useState<string | undefined>();
  const [switchTarget, setSwitchTarget] = useState<'llm' | 'tts'>('llm');
  const [pendingModelRepo, setPendingModelRepo] = useState<string>('');
  const [pendingTtsBackend, setPendingTtsBackend] = useState<'chatterbox-turbo' | 'qwen3-tts' | ''>('');

  const isLikelyDevicePort = (port: string) => /\/dev\/(cu|tty)\.(usbserial|usbmodem)/i.test(port);

  const getRecommendedPort = (candidates: string[]) => {
    const prefer = candidates.find((p) => isLikelyDevicePort(p));
    return prefer || '';
  };

  const recommendedPort = getRecommendedPort(ports);
  const flashEnabled = !!selectedPort && isLikelyDevicePort(selectedPort) && !flashing;

  const openPermissionPane = async (kind: 'microphone' | 'local-network') => {
    setOpeningPermission(kind);
    setPermissionFeedback(null);
    try {
      const msg = await invoke<string>('open_system_permission', { kind });
      setPermissionFeedback(msg || 'Opened System Settings.');
    } catch (e: any) {
      setPermissionFeedback(e?.message || 'Could not open System Settings automatically.');
    } finally {
      setOpeningPermission(null);
    }
  };

  const requestPermission = async (kind: 'microphone' | 'local-network') => {
    setRequestingPermission(kind);
    setPermissionFeedback(null);
    try {
      if (kind === 'microphone') {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Microphone permission is unavailable in this context.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setMicEnabled(true);
        setPermissionFeedback('Microphone access granted.');
      } else {
        try {
          await invoke<string>('trigger_local_network_prompt');
        } catch {
          // Non-fatal.
        }
        const msg = await invoke<string>('open_system_permission', { kind: 'local-network' });
        setLocalNetworkRequested(true);
        setPermissionFeedback(msg || 'Opened Local Network settings.');
      }
    } catch (e: any) {
      const name = String(e?.name || '');
      if (kind === 'microphone' && (name === 'NotAllowedError' || name === 'SecurityError')) {
        setPermissionFeedback('Microphone access denied. Click "Open Settings" and allow OpenToys.');
      } else {
        setPermissionFeedback(e?.message || 'Permission request failed.');
      }
    } finally {
      setRequestingPermission(null);
    }
  };

  useEffect(() => {
    loadSettings();
    loadSystemProfile();
    return () => {};
  }, []);

  const loadSystemProfile = async () => {
    try {
      const profile = await invoke<SystemProfile>('get_system_profile');
      setSystemProfile(profile);
    } catch (e) {
      console.warn('Failed to read system profile:', e);
      setSystemProfile(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadMicPermission = async () => {
      try {
        const perms = (navigator as any).permissions;
        if (!perms?.query) return;
        const status = await perms.query({ name: 'microphone' as PermissionName });
        if (!cancelled) setMicEnabled(status.state === 'granted');
      } catch {
        // ignore
      }
    };
    void loadMicPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshPorts();
  }, []);

  const refreshPorts = async () => {
    try {
      const res = await api.firmwarePorts();
      const nextPorts = (res?.ports || []) as string[];
      setPorts(nextPorts);
      const recommended = getRecommendedPort(nextPorts);
      if (recommended && (!selectedPort || !isLikelyDevicePort(selectedPort))) {
        setSelectedPort(recommended);
      }
    } catch {
      setPorts([]);
    }
  };

  const flashFirmware = async () => {
    if (!selectedPort || flashing) return;
    setFlashing(true);
    setFlashLog('Flashing… do not unplug the device.\n');
    try {
      const res = await api.flashFirmware({ port: selectedPort, chip: 'esp32s3', baud: 460800 });
      if (res?.output) setFlashLog(String(res.output));
      else setFlashLog(JSON.stringify(res, null, 2));
      if (res?.ok) {
        setFlashLog((prev) => prev + "\n\nDone." );
      }
    } catch (e: any) {
      setFlashLog(e?.message || 'Flashing failed');
    } finally {
      setFlashing(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [modelData, volSetting] = await Promise.all([
        api.getModels(),
        api.getSetting('laptop_volume').catch(() => ({ key: 'laptop_volume', value: '70' })),
      ]);
      setModels(modelData);
      setLlmRepo(modelData.llm.repo);
      const normalizedTts =
        modelData?.tts?.backend === 'chatterbox-turbo' ? 'chatterbox-turbo' : 'qwen3-tts';
      setTtsBackend(normalizedTts);
      const raw = (volSetting as any)?.value;
      const parsed = raw != null ? Number(raw) : 70;
      setLaptopVolume(Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 70);

    } catch (e) {
      console.error('Failed to load settings:', e);
      setError('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveModel = async () => {
    if (!llmRepo.trim()) return;
    
    // Open the modal and start the switch process
    setSwitchTarget('llm');
    setPendingModelRepo(llmRepo);
    setPendingTtsBackend('');
    setShowSwitchModal(true);
    setSwitchStage('downloading');
    setSwitchProgress(0);
    setSwitchMessage('Starting...');
    setSwitchError(undefined);
    
    await performModelSwitch(llmRepo);
  };

  const handleSaveTts = async () => {
    try {
      setSavingTts(true);
      setSwitchTarget('tts');
      setPendingModelRepo('');
      setPendingTtsBackend(ttsBackend);
      setShowSwitchModal(true);
      setSwitchStage('downloading');
      setSwitchProgress(0);
      setSwitchMessage('Starting...');
      setSwitchError(undefined);
      await performTtsSwitch(ttsBackend);
    } catch (e) {
      console.error('Failed to set TTS backend:', e);
      setError('Failed to update TTS backend.');
    } finally {
      setSavingTts(false);
    }
  };

  const performModelSwitch = async (modelRepo: string) => {
    try {
      for await (const update of api.switchModel(modelRepo)) {
        if (update.stage === 'error') {
          setSwitchStage('error');
          setSwitchError(update.error);
          setSwitchProgress(0);
          setSwitchMessage('Failed');
          return;
        }
        
        setSwitchStage(update.stage);
        setSwitchProgress(update.progress ?? 0);
        setSwitchMessage(update.message ?? '');
        
        if (update.stage === 'complete') {
          // Refresh settings to show the new model
          await loadSettings();
        }
      }
    } catch (e: any) {
      console.error('Model switch failed:', e);
      setSwitchStage('error');
      setSwitchError(e?.message || 'Unknown error');
    }
  };

  const performTtsSwitch = async (backend: 'chatterbox-turbo' | 'qwen3-tts') => {
    try {
      for await (const update of api.switchTts(backend)) {
        if (update.stage === 'error') {
          setSwitchStage('error');
          setSwitchError(update.error);
          setSwitchProgress(0);
          setSwitchMessage('Failed');
          return;
        }

        setSwitchStage(update.stage);
        setSwitchProgress(update.progress ?? 0);
        setSwitchMessage(update.message ?? '');

        if (update.stage === 'complete') {
          await loadSettings();
        }
      }
    } catch (e: any) {
      console.error('TTS switch failed:', e);
      setSwitchStage('error');
      setSwitchError(e?.message || 'Unknown error');
    }
  };

  const handleRetrySwitch = () => {
    setSwitchStage('downloading');
    setSwitchProgress(0);
    setSwitchMessage('Retrying...');
    setSwitchError(undefined);

    if (switchTarget === 'llm' && pendingModelRepo) {
      performModelSwitch(pendingModelRepo);
      return;
    }
    if (switchTarget === 'tts' && pendingTtsBackend) {
      performTtsSwitch(pendingTtsBackend);
    }
  };

  const handleCloseModal = () => {
    setShowSwitchModal(false);
    setPendingModelRepo('');
    setPendingTtsBackend('');
  };


  // pip only reports progress if we stream it, so the Rust side emits a
  // deps-progress event per package rather than blocking until it finishes.
  useEffect(() => {
    if (!updatingDeps) return;
    const started = Date.now();
    setDepsElapsed(0);
    const id = window.setInterval(
      () => setDepsElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, [updatingDeps]);

  const updatePythonPackages = async () => {
    setUpdatingDeps(true);
    setDepsError(null);
    setDepsProgress(null);
    setDepsStatus('Starting...');

    const unlisten = await listen<DepsProgress>('deps-progress', (event) => {
      if (event.payload) {
        setDepsProgress(event.payload);
        setDepsStatus(null);
      }
    }).catch(() => null);

    try {
      await invoke('install_python_deps');
      setDepsProgress(null);
      setDepsStatus('Restarting engine...');
      await invoke('restart_backend');

      // The replacement process has to be up before the app talks to it again.
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          await api.health();
          break;
        } catch {
          if (Date.now() > deadline) throw new Error('Engine did not restart. Reopen the app.');
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      setDepsStatus('Up to date');
      await loadSettings();
    } catch (e: any) {
      setDepsError(e?.message || String(e) || 'Update failed');
      setDepsStatus(null);
      setDepsProgress(null);
    } finally {
      if (unlisten) unlisten();
      setUpdatingDeps(false);
    }
  };

  const selectedTtsMeta = TTS_OPTIONS.find((o) => o.id === ttsBackend) || null;

  return (
    <div className="settings-page space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-2xl font-bold flex items-center gap-3 settings-title">
          Settings
        </h2>
        {systemProfile && (
          <div className="rounded-[6px] bg-white px-3 py-2 text-right">
            <div className="text-xs font-bold text-gray-900">{systemProfile.chip || 'Unknown chip'}</div>
            <div className="text-[10px] text-gray-600 font-mono">
              {systemProfile.total_memory_gb ? `${systemProfile.total_memory_gb} GB RAM` : 'RAM unknown'}
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 font-bold rounded-[6px]">
          {error}
        </div>
      )}
      
      <div className="retro-card settings-shell space-y-8 border border-gray-200 shadow-sm">
        
        {/* Mode Section */}
        <div className="settings-section space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="font-bold uppercase text-lg">Who is this for?</h3>
          </div>
          <p className="text-xs text-gray-600">
            Sets how the assistant replies and how the app looks. Story mode works in both.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AUDIENCE_OPTIONS.map((opt) => {
              const selected = audienceMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={!audienceLoaded}
                  onClick={() => { void setAudienceMode(opt.id); }}
                  className={`retro-card text-left ${selected ? 'retro-selected' : 'retro-not-selected'} disabled:opacity-60`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-base">{opt.name}</span>
                    {selected && (
                      <span className="label-mono" style={{ color: 'var(--color-retro-accent)' }}>Active</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-600">{opt.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* LLM Section */}
        <div className="settings-section pt-8 border-t border-gray-200 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              <h3 className="font-bold uppercase text-lg">Language Model (LLM)</h3>
            </div>
            <button
              onClick={handleSaveModel}
              disabled={showSwitchModal || loading || !llmRepo || llmRepo === models?.llm.repo}
              className="retro-btn retro-btn-outline settings-action text-gray-900 disabled:opacity-50 flex items-center gap-2"
            >
              <Rss className="w-4 h-4" />
              Update
            </button>
          </div>
          
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <LlmSelector
                value={llmRepo}
                onChange={(repoId) => setLlmRepo(repoId)}
                disabled={showSwitchModal || loading}
                systemMemoryGb={systemProfile?.total_memory_gb ?? null}
                label=""
              />
            </div>
          </div>
          <p className="text-[10px] mt-2 opacity-60">
            {models?.llm.loaded ? (
              <span className="text-green-600 font-bold">● LLM Active</span>
            ) : (
              <span className="text-red-500 font-bold">● LLM Not Active</span>
            )}
          </p>
        </div>

        <div className="settings-section pt-8 border-t border-gray-200 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              <h3 className="font-bold uppercase text-lg">Text to Speech (TTS)</h3>
            </div>
            <button
              onClick={handleSaveTts}
              disabled={savingTts || loading || ttsBackend === (models?.tts?.backend === 'chatterbox-turbo' ? 'chatterbox-turbo' : 'qwen3-tts')}
              className="retro-btn retro-btn-outline settings-action text-gray-900 disabled:opacity-50 flex items-center gap-2"
            >
              <Rss className="w-4 h-4" />
              Update
            </button>
          </div>
          <select
            className="retro-input bg-white border border-gray-200 w-full"
            value={ttsBackend}
            onChange={(e) => setTtsBackend((e.target.value as 'chatterbox-turbo' | 'qwen3-tts'))}
            disabled={savingTts || loading}
          >
            {TTS_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
          {selectedTtsMeta && (
            <div className="text-xs text-gray-600">
              ~{selectedTtsMeta.ramGb}GB RAM · ~{selectedTtsMeta.diskGb}GB Disk · {selectedTtsMeta.quality}
            </div>
          )}
          <p className="text-[10px] mt-2 opacity-60">
            {models?.tts?.loaded ? (
              <span className="text-green-600 font-bold">● TTS Active</span>
            ) : (
              <span className="text-red-500 font-bold">● TTS Not Active</span>
            )}
          </p>
        </div>

        <div className="settings-section pt-8 border-t border-gray-200">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex flex-col gap-1">
              <h3 className="flex items-center gap-2 font-bold uppercase text-lg">
            <MonitorUp className="w-5 h-5" />
            Connect your ESP32 Here
          </h3>
            </div>
              <button
                type="button"
                className="retro-btn retro-btn-outline settings-action text-gray-900 disabled:opacity-50 flex items-center gap-2"
                onClick={flashFirmware}
                disabled={!flashEnabled}
              >
                <Zap size={16} />{flashing ? 'Flashing…' : 'Flash'}
              </button>
          </div>
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs text-gray-500 uppercase">Serial Port</div>
              <button
                type="button"
                className="inline-flex items-center gap-2 text-xs font-bold uppercase opacity-60 hover:opacity-100 disabled:opacity-30"
                onClick={refreshPorts}
                disabled={flashing}
              >
                <RefreshCw className={flashing ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                Refresh
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <select
                className="retro-input bg-white border border-gray-200 flex-1"
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                disabled={flashing}
              >
                {ports.length === 0 && <option value="">No ports found</option>}
                {ports.map((p) => (
                  <option key={p} value={p} disabled={!isLikelyDevicePort(p)}>
                    {p}{recommendedPort && p === recommendedPort ? ' (recommended)' : ''}{!isLikelyDevicePort(p) ? ' (not a device)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 text-[10px] opacity-60 font-mono">
              On MacOS, pick /dev/cu.usbserial-* (often -210/-110/-10) or /dev/cu.usbmodem*. Avoid Bluetooth ports.
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs text-gray-500 uppercase mb-2">Output</div>
            <pre className="bg-white border border-gray-200 rounded-[6px] p-3 text-xs font-mono whitespace-pre-wrap max-h-56 overflow-auto">
              {flashLog || '—'}
            </pre>
          </div>
        </div>

        {/* Device Status Section */}
        <div className="settings-section pt-8 border-t border-gray-200">
          <h3 className="flex items-center gap-2 font-bold uppercase text-lg">
            <Radio className="w-5 h-5" />
            Device Settings
          </h3>
          
          {/* <div className="grid grid-cols-1 md:grid-cols-2 mt-2 gap-4">
            <div className="p-4 flex items-start flex-col sm:flex-row gap-4 justify-between">
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1">
                  <Wifi className="w-3 h-3" /> Connection
                </div>
                <div className={`text-lg font-black ${device?.ws_status === 'connected' ? 'text-green-600' : 'text-red-500'}`}>
                  {device?.ws_status === 'connected' ? 'ONLINE' : 'OFFLINE'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500 uppercase mb-1">MAC Address</div>
                <div className="font-mono font-bold tracking-widest text-sm">
                  {device?.mac_address || 'Not found'}
                </div>
              </div>
            </div>
          </div> */}
          <div className="py-4">
            <div className="text-xs text-gray-500 uppercase mb-2">Laptop Volume</div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                value={laptopVolume}
                onChange={(e) => {
                  const vol = Math.max(0, Math.min(100, Number(e.target.value)));
                  setLaptopVolume(vol);
                  api.setSetting('laptop_volume', String(vol)).catch(console.error);
                }}
                className="retro-range w-full h-2 bg-white rounded-[6px] appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(#9b5cff 0 0) 0/${Math.max(0, Math.min(100, laptopVolume))}% 100% no-repeat, white`,
                }}
              />
              <span className="font-black w-12 text-right">{laptopVolume}%</span>
            </div>
          </div>
        </div>

        {/* App Packages Section */}
        <div className="settings-section pt-8 border-t border-gray-200 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              <h3 className="font-bold uppercase text-lg">App Packages</h3>
            </div>
            <button
              type="button"
              onClick={updatePythonPackages}
              disabled={updatingDeps}
              className="retro-btn retro-btn-outline settings-action text-gray-900 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${updatingDeps ? 'animate-spin' : ''}`} />
              {updatingDeps ? 'Updating' : 'Update'}
            </button>
          </div>

          {!updatingDeps && !depsError && !depsStatus && (
            <p className="text-xs text-gray-600">
              The Python packages this app runs on. Redownload if a new model won't load.
            </p>
          )}

          {(updatingDeps || depsStatus) && !depsError && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs font-mono">
                <span className="truncate text-gray-700">
                  {depsProgress?.phase === 'downloading' && `Downloading ${depsProgress.package}`}
                  {depsProgress?.phase === 'installing' &&
                    `Installing ${depsProgress.total ?? ''} packages`}
                  {depsProgress?.phase === 'done' && 'Finishing up'}
                  {!depsProgress && depsStatus}
                </span>
                <span className="shrink-0 text-gray-500 tabular">
                  {depsProgress?.phase === 'downloading' && `${depsProgress.downloaded} · `}
                  {formatElapsed(depsElapsed)}
                </span>
              </div>
              {updatingDeps && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--color-retro-accent)]" />
                </div>
              )}
            </div>
          )}

          {depsError && <p className="text-xs text-red-600 font-mono break-words">{depsError}</p>}
        </div>

        <div className="settings-section pt-8 border-t border-gray-200 space-y-4">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            <h3 className="font-bold uppercase text-lg">Permissions</h3>
          </div>
          <div className="space-y-3">
            <div className="rounded-[6px] border border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  Microphone
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {micEnabled ? 'Granted' : 'Not granted'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={micEnabled}
                  aria-label="Request microphone access"
                  onClick={() => void requestPermission('microphone')}
                  disabled={requestingPermission !== null}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                    micEnabled ? 'bg-green-500 border-green-500' : 'bg-gray-200 border-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      micEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  className="text-xs font-bold uppercase opacity-60 hover:opacity-100"
                  onClick={() => void openPermissionPane('microphone')}
                  disabled={openingPermission !== null}
                >
                  {openingPermission === 'microphone' ? 'Opening…' : 'Open Settings'}
                </button>
              </div>
            </div>

            <div className="rounded-[6px] border border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                  <Network className="w-4 h-4" />
                  Local Network
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {localNetworkRequested ? 'Requested' : 'Not requested'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={localNetworkRequested}
                  aria-label="Request local network access"
                  onClick={() => void requestPermission('local-network')}
                  disabled={requestingPermission !== null}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                    localNetworkRequested ? 'bg-green-500 border-green-500' : 'bg-gray-200 border-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      localNetworkRequested ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  className="text-xs font-bold uppercase opacity-60 hover:opacity-100"
                  onClick={() => void openPermissionPane('local-network')}
                  disabled={openingPermission !== null}
                >
                  {openingPermission === 'local-network' ? 'Opening…' : 'Open Settings'}
                </button>
              </div>
            </div>
          </div>
          {permissionFeedback && (
            <div className="text-xs font-mono text-gray-600  py-2">
              {permissionFeedback}
            </div>
          )}
        </div>
      </div>

      {/* Model Switch Modal */}
      <ModelSwitchModal
        isOpen={showSwitchModal}
        stage={switchStage}
        progress={switchProgress}
        message={switchMessage}
        error={switchError}
        title={switchTarget === 'tts' ? 'Switching Voice Engine' : 'Switching Model'}
        downloadingLabel={switchTarget === 'tts' ? 'Downloading Voice Model' : 'Downloading Model'}
        loadingLabel={switchTarget === 'tts' ? 'Loading Voice Weights' : 'Loading Weights'}
        onRetry={handleRetrySwitch}
        onClose={handleCloseModal}
      />
    </div>
  );
};
