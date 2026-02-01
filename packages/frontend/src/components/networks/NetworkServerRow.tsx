import { useNavigate } from 'react-router-dom';
import {
  Play,
  Square,
  RotateCw,
  Terminal,
  Settings,
  Users,
  Cpu,
  HardDrive,
  Skull,
  Trash2,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import type { ServerNetworkMember } from '../../types';

interface MemberStatus {
  serverId: string;
  serverName: string;
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  playerCount?: number;
}

interface LocalServer {
  id: string;
  name: string;
  status: string;
  [key: string]: any;
}

interface NetworkServerRowProps {
  member: ServerNetworkMember;
  memberStatus?: MemberStatus;
  localServer?: LocalServer;
  isLast: boolean;
  onAction: (serverId: string, action: 'start' | 'stop' | 'restart' | 'kill' | 'delete') => void;
}

export const NetworkServerRow = ({
  member,
  memberStatus,
  localServer,
  isLast,
  onAction,
}: NetworkServerRowProps) => {
  const navigate = useNavigate();

  // Prefer local server status for immediate UI updates, fall back to member status from API
  const serverStatus = localServer?.status || memberStatus?.status || member.server.status || 'stopped';
  const isRunning = serverStatus === 'running';
  const isStopped = serverStatus === 'stopped';
  const isStopping = serverStatus === 'stopping';
  const isStarting = serverStatus === 'starting';
  const isCrashed = serverStatus === 'crashed';
  const canStart = isStopped || isCrashed;
  const canDelete = isStopped || isCrashed;

  const getStatusColor = () => {
    switch (serverStatus) {
      case 'running':
        return 'bg-success';
      case 'stopped':
        return 'bg-gray-500';
      case 'starting':
      case 'stopping':
        return 'bg-warning';
      case 'crashed':
        return 'bg-danger';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusBadge = () => {
    switch (serverStatus) {
      case 'running':
        return <Badge variant="success" size="sm">Running</Badge>;
      case 'stopped':
        return <Badge variant="default" size="sm">Stopped</Badge>;
      case 'starting':
        return <Badge variant="warning" size="sm">Starting</Badge>;
      case 'stopping':
        return <Badge variant="warning" size="sm">Stopping</Badge>;
      case 'crashed':
        return <Badge variant="danger" size="sm">Crashed</Badge>;
      default:
        return <Badge variant="default" size="sm">Unknown</Badge>;
    }
  };

  const getRoleBadge = () => {
    switch (member.role) {
      case 'proxy':
        return <Badge variant="info" size="sm">Proxy</Badge>;
      case 'backend':
        return <Badge variant="warning" size="sm">Backend</Badge>;
      default:
        return null;
    }
  };

  const formatMemory = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors ${
        !isLast ? 'border-b border-gray-800' : ''
      }`}
    >
      {/* Server Info */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Indent + Status Indicator */}
        <div className="flex items-center gap-2 pl-6">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        </div>

        {/* Server Name & Badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-medium text-text-light-primary dark:text-text-primary truncate cursor-pointer hover:text-accent-primary transition-colors"
              onClick={() => navigate(`/servers/${member.serverId}`)}
            >
              {member.server.name}
            </span>
            {getRoleBadge()}
            {getStatusBadge()}
          </div>
        </div>
      </div>

      {/* Server Stats */}
      <div className="hidden md:flex items-center gap-6 mr-4">
        {/* Players */}
        <div className="flex items-center gap-1 min-w-[50px]">
          <Users size={12} className="text-accent-primary" />
          <span className="text-sm text-text-light-muted dark:text-text-muted">
            {memberStatus?.playerCount ?? 0}
          </span>
        </div>

        {/* CPU */}
        <div className="flex items-center gap-1 min-w-[50px]">
          <Cpu size={12} className="text-warning" />
          <span className="text-sm text-text-light-muted dark:text-text-muted">
            {memberStatus?.cpuUsage?.toFixed(1) ?? '0'}%
          </span>
        </div>

        {/* Memory */}
        <div className="flex items-center gap-1 min-w-[70px]">
          <HardDrive size={12} className="text-accent-secondary" />
          <span className="text-sm text-text-light-muted dark:text-text-muted">
            {formatMemory(memberStatus?.memoryUsage ?? 0)}
          </span>
        </div>
      </div>

      {/* Server Actions */}
      <div className="flex items-center gap-1">
        {isStopping ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Skull size={14} />}
            onClick={() => onAction(member.serverId, 'kill')}
            className="text-danger hover:bg-danger/10"
            title="Force Kill Server"
          />
        ) : canStart ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Play size={14} />}
            onClick={() => onAction(member.serverId, 'start')}
            title="Start Server"
          />
        ) : isStarting ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Play size={14} />}
            disabled
            title="Starting..."
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<Square size={14} />}
            onClick={() => onAction(member.serverId, 'stop')}
            title="Stop Server"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCw size={14} />}
          onClick={() => onAction(member.serverId, 'restart')}
          disabled={canStart || isStopping || isStarting}
          title="Restart Server"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<Terminal size={14} />}
          onClick={() => navigate(`/console/${member.serverId}`)}
          disabled={!isRunning}
          title="Console"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<Settings size={14} />}
          onClick={() => navigate(`/servers/${member.serverId}`)}
          title="Server Settings"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={() => onAction(member.serverId, 'delete')}
          disabled={!canDelete}
          className="text-danger hover:bg-danger/10"
          title={!canDelete ? 'Stop server before deleting' : 'Delete Server'}
        />
      </div>
    </div>
  );
};
