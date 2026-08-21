import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, LockKeyhole, Volume2, Settings, History, Plus, Home, Dot } from 'lucide-react';
import clsx from 'clsx';
import { useActiveUser } from '../state/ActiveUserContext';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Logo } from './Logo';
import elatoPng from '../assets/device.png';
import { Modal } from './Modal';
import { CreateTiles } from './CreateTiles';

const ICON_SIZE = 28

const NavItem = ({
  to,
  icon: Icon,
  label,
  trailingIcon: TrailingIcon,
  matchPath,
  iconOnly = false,
  className = "",
}: {
  to: string;
  icon: any;
  label: string;
  trailingIcon?: any;
  matchPath?: string;
  iconOnly?: boolean;
  className?: string;
}) => {
  const location = useLocation();
  const isActive = matchPath ? location.pathname === matchPath : location.pathname === to;

  return (
    <Link
      to={to}
      className={clsx(
        "sidebar-nav-item flex items-center transition-colors text-[15px]",
        iconOnly
          ? "sidebar-nav-icon justify-center w-full h-9 rounded-[4px] border border-transparent hover:border-gray-200"
          : "gap-3 px-4 py-2.5",
        isActive ? "is-active" : "hover:bg-gray-50",
        className
      )}
      aria-label={label}
    >
      <Icon size={iconOnly ? 18 : 17} />
      {iconOnly ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className={`${isActive ? "font-bold" : "font-medium"} flex-1 tracking-tight`}>{label}</span>
      )}
      {!iconOnly && TrailingIcon && <TrailingIcon size={16} className="opacity-30 shrink-0" />}
    </Link>
  );
};

export const Sidebar = () => {
  const navigate = useNavigate();
  const { activeUser } = useActiveUser();
  const [_activePersonalityName, setActivePersonalityName] = useState<string | null>(null);
  const [activeExperienceId, setActiveExperienceId] = useState<string | null>(null);
  const [_activeExperienceType, setActiveExperienceType] = useState<string | null>(null);
  const [_deviceConnected, setDeviceConnected] = useState<boolean>(false);
  const [_deviceSessionId, setDeviceSessionId] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const ds = { connected: false, session_id: null };
        // const ds = await api.getDeviceStatus().catch(() => ({ connected: false, session_id: null }));
        if (!cancelled) {
          setDeviceConnected(!!ds?.connected);
          setDeviceSessionId(ds?.session_id || null);
        }

        const selectedId = activeUser?.current_personality_id;
        if (!selectedId) {
          if (!cancelled) setActivePersonalityName(null);
          if (!cancelled) {
            setActiveExperienceId(null);
            setActiveExperienceType(null);
          }
          return;
        }

        const ps = await api.getPersonalities(true).catch(() => []);
        const selected = ps.find((p: any) => p.id === selectedId);
        if (!cancelled) {
          setActivePersonalityName(selected?.name || null);
          setActiveExperienceId(selected?.id ? String(selected.id) : null);
          setActiveExperienceType(selected?.type ? String(selected.type) : null);
        }
      } catch {
        // ignore
      }
    };

    load();
  }, [activeUser?.current_personality_id]);

  return (
    <div className="sidebar-wrap w-64 shrink-0 bg-transparent p-6 flex flex-col gap-6 h-full overflow-y-auto overscroll-contain justify-between">
      <div className="sidebar-shell overflow-hidden">
        <div className="sidebar-brand p-4 pb-3 text-black flex flex-col items-center">
          <Logo />
          <p className="label-mono mt-1.5" style={{ letterSpacing: '0.08em' }}>Local · Open Source</p>
        </div>
        <div className="bg-transparent">
          <nav className="flex flex-col">
            <div className="p-3 pb-4">
              <button
                type="button"
                className="retro-btn w-full flex items-center justify-center gap-2"
                onClick={() => setCreateMenuOpen(true)}
              >
                <Plus size={15} />
                Create
              </button>
            </div>
            <NavItem
              to={
                activeExperienceId
                  ? `/?focus=${encodeURIComponent(activeExperienceId)}`
                  : "/"
              }
              icon={Home}
              label="Home"
              matchPath="/"
            />
            <NavItem to="/voices" icon={Volume2} label="Voices" />
            <div className="grid grid-cols-3 gap-1.5 px-3 py-3 mt-2 w-full border-t border-gray-100">
              <NavItem
                to="/conversations"
                icon={History}
                label="Sessions"
                trailingIcon={LockKeyhole}
                iconOnly
              />
              <NavItem to="/users" icon={Users} label="Members" iconOnly />
              <NavItem to="/settings" icon={Settings} label="Settings" iconOnly />
            </div>
          </nav>
        </div>
      </div>
      <div className="sidebar-footer flex flex-col gap-3 flex-wrap text-xs font-mono">
        <a
          href="https://www.elatoai.com/products"
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit opacity-70 hover:opacity-100 hover:scale-105 transition-all hover:-rotate-3 duration-300 ease-in-out"
        >
          <img src={elatoPng} alt="Elato" className="w-18 h-auto object-contain" />
        </a>
        <div className="flex items-center" style={{ fontSize: '10px'}}>
        <a
          href="https://www.elatoai.com/products"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 opacity-70 hover:opacity-100"
        >
          DIY AI Toys
        </a>
        <Dot size={16} className="opacity-70" />
          <a
            href="mailto:akash@elatoai.com"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 opacity-70 hover:opacity-100"
          >
            Get Support
          </a>
</div>

      </div>
      <Modal
        open={createMenuOpen}
        icon={<Plus size={24} />}
        title="Create"
        onClose={() => setCreateMenuOpen(false)}
        panelClassName="w-full max-w-3xl"
      >
        <CreateTiles
          iconSize={ICON_SIZE}
          onSelect={(kind) => {
            if (kind === "voice") {
              setCreateMenuOpen(false);
              navigate("/voices?create=voice");
              return;
            }
            const tab = kind === "character" ? "personality" : kind;
            setCreateMenuOpen(false);
            navigate(`/?tab=${tab}&create=1`);
          }}
        />
      </Modal>
    </div>
  );
};
