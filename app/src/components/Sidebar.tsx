import { Link, useLocation } from 'react-router-dom';
import { Users, LockKeyhole, MessagesSquare, Volume2, Sparkles, Settings, Gamepad2, History } from 'lucide-react';
import clsx from 'clsx';
import { useActiveUser } from '../state/ActiveUserContext';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { User } from 'lucide-react';
import { Logo } from './Logo';

const NavItem = ({
  to,
  icon: Icon,
  label,
  trailingIcon: TrailingIcon,
  trailingTooltip,
  matchPath,
}: {
  to: string;
  icon: any;
  label: string;
  trailingIcon?: any;
  trailingTooltip?: string;
  matchPath?: string;
}) => {
  const location = useLocation();
  const isActive = matchPath ? location.pathname === matchPath : location.pathname === to;

  return (
    <Link
      to={to}
      className={clsx(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-100",
        isActive
          ? "bg-gray-100 text-black"
          : "bg-white"
      )}
      title={trailingTooltip}
    >
      <Icon size={20} />
      <span className={`${isActive ? "font-bold" : "font-medium"} flex-1`}>{label}</span>
      {TrailingIcon && <TrailingIcon size={16} className="opacity-30 shrink-0" />}
    </Link>
  );
};

export const Sidebar = () => {
  const { users, activeUserId, activeUser, setActiveUserId } = useActiveUser();
  const [_activePersonalityName, setActivePersonalityName] = useState<string | null>(null);
  const [activeExperienceId, setActiveExperienceId] = useState<string | null>(null);
  const [activeExperienceType, setActiveExperienceType] = useState<string | null>(null);
  const [_deviceConnected, setDeviceConnected] = useState<boolean>(false);
  const [_deviceSessionId, setDeviceSessionId] = useState<string | null>(null);

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
    <div className="w-64 shrink-0 bg-transparent p-6 flex flex-col gap-6 h-full overflow-y-auto overscroll-contain">
      <div className="bg-white rounded-[24px] overflow-hidden shadow-[0_12px_28px_rgba(0,0,0,0.08)] border border-gray-200">
        <div className="p-4 bg-white text-black flex flex-col items-center">
          <Logo />
          <p className="text-xs font-mono opacity-90">Epic Local AI Toys</p>
        </div>
        <div className="bg-transparent border-t border-gray-200">
          <nav className="flex flex-col">
            <NavItem
              to={
                activeExperienceId && activeExperienceType
                  ? `/?tab=${encodeURIComponent(activeExperienceType)}&focus=${encodeURIComponent(activeExperienceId)}`
                  : "/"
              }
              icon={Gamepad2}
              label="Playground"
              matchPath="/"
            />
            <NavItem to="/voices" icon={Volume2} label="Voices" />
            <NavItem to="/conversations" icon={History} label="Sessions" trailingIcon={LockKeyhole} trailingTooltip="Private & secure" />
            <NavItem to="/users" icon={Users} label="Members" />
            <NavItem to="/settings" icon={Settings} label="Settings" />
          </nav>
        </div>
        <div className="p-4 bg-transparent border-t border-gray-200">
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">
              Active
            </div>
            <div className="flex items-center gap-2">
              <User />
              <select
                className="w-full px-3 py-2 bg-white text-black border border-gray-200 rounded-[18px]"
                value={activeUserId || ''}
                onChange={(e) => setActiveUserId(e.target.value || null)}
              >
                {users.length === 0 && <option value="">No members</option>}
                {users.length > 0 && !activeUserId && <option value="">Select User...</option>}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

      </div>
      
    </div>
  );
};
