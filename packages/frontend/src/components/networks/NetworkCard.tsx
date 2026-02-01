import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  RotateCw,
  Users,
  Cpu,
  HardDrive,
  Settings,
  Trash2,
} from 'lucide-react';
import { Card, Button, Badge } from '../ui';
import { NetworkServerRow } from './NetworkServerRow';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type {
  NetworkWithMembers,
  NetworkStatus,
  AggregatedMetrics,
} from '../../types';

interface Server {
  id: string;
  name: string;
  status: string;
  [key: string]: any;
}

interface NetworkCardProps {
  network: NetworkWithMembers;
  status?: NetworkStatus;
  metrics?: AggregatedMetrics;
  servers: Server[];
  expanded: boolean;
  onToggleExpand: () => void;
  onStartNetwork: (networkId: string) => void;
  onStopNetwork: (networkId: string) => void;
  onRestartNetwork: (networkId: string) => void;
  onDeleteNetwork: (networkId: string) => void;
  onManageServers: (network: NetworkWithMembers) => void;
  onServerAction: (serverId: string, action: 'start' | 'stop' | 'restart' | 'kill' | 'delete') => void;
  isLoading?: boolean;
}

export const NetworkCard = ({
  network,
  status,
  metrics,
  servers,
  expanded,
  onToggleExpand,
  onStartNetwork,
  onStopNetwork,
  onRestartNetwork,
  onDeleteNetwork,
  onManageServers,
  onServerAction,
  isLoading,
}: NetworkCardProps) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const networkStatus = status?.status || 'stopped';
  const isRunning = networkStatus === 'running';
  const isStopped = networkStatus === 'stopped';
  const isPartial = networkStatus === 'partial';

  const getStatusColor = () => {
    switch (networkStatus) {
      case 'running':
        return 'bg-success';
      case 'stopped':
        return 'bg-gray-500';
      case 'starting':
      case 'stopping':
        return 'bg-warning';
      case 'partial':
        return 'bg-accent-secondary';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusBadge = () => {
    switch (networkStatus) {
      case 'running':
        return <Badge variant="success">Running</Badge>;
      case 'stopped':
        return <Badge variant="default">Stopped</Badge>;
      case 'starting':
        return <Badge variant="warning">Starting</Badge>;
      case 'stopping':
        return <Badge variant="warning">Stopping</Badge>;
      case 'partial':
        return <Badge variant="info">Partial</Badge>;
      default:
        return <Badge variant="default">Unknown</Badge>;
    }
  };

  const formatMemory = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  return (
    <>
      <Card variant="glass" className="mb-4 overflow-hidden">
        {/* Network Header - Always Visible */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={onToggleExpand}
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Expand/Collapse Icon */}
            <div className="text-text-light-muted dark:text-text-muted">
              {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </div>

            {/* Network Color Indicator */}
            <div
              className="w-1 h-12 rounded-full flex-shrink-0"
              style={{ backgroundColor: network.color || '#00FF88' }}
            />

            {/* Network Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-heading font-bold text-text-light-primary dark:text-text-primary truncate">
                  {network.name}
                </h3>
                <Badge variant={network.networkType === 'proxy' ? 'info' : 'default'} size="sm">
                  {network.networkType}
                </Badge>
                {getStatusBadge()}
              </div>
              <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                {network.members.length} server{network.members.length !== 1 ? 's' : ''}
                {network.description && ` - ${network.description}`}
              </p>
            </div>
          </div>

          {/* Network Summary Stats */}
          <div className="hidden lg:flex items-center gap-6">
            {/* Total Players */}
            <div className="text-center min-w-[60px]">
              <div className="flex items-center justify-center gap-1">
                <Users size={14} className="text-accent-primary" />
                <span className="text-lg font-bold text-text-light-primary dark:text-text-primary">
                  {metrics?.totalPlayers ?? 0}
                </span>
              </div>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Players</p>
            </div>

            {/* Average CPU */}
            <div className="text-center min-w-[60px]">
              <div className="flex items-center justify-center gap-1">
                <Cpu size={14} className="text-warning" />
                <span className="text-lg font-bold text-text-light-primary dark:text-text-primary">
                  {metrics?.averageCpuUsage?.toFixed(1) ?? '0'}%
                </span>
              </div>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Avg CPU</p>
            </div>

            {/* Total Memory */}
            <div className="text-center min-w-[80px]">
              <div className="flex items-center justify-center gap-1">
                <HardDrive size={14} className="text-accent-secondary" />
                <span className="text-lg font-bold text-text-light-primary dark:text-text-primary">
                  {formatMemory(metrics?.totalMemoryUsage ?? 0)}
                </span>
              </div>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Memory</p>
            </div>

            {/* Server Status Summary */}
            <div className="text-center min-w-[60px]">
              <div className="flex items-center justify-center gap-1">
                <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
                <span className="text-lg font-bold text-text-light-primary dark:text-text-primary">
                  {status?.runningServers ?? 0}/{status?.totalServers ?? network.members.length}
                </span>
              </div>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Online</p>
            </div>
          </div>

          {/* Bulk Actions */}
          <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
            {isStopped || isPartial ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Play size={16} />}
                onClick={() => onStartNetwork(network.id)}
                disabled={isLoading}
                title="Start All"
              />
            ) : null}
            {isRunning || isPartial ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Square size={16} />}
                onClick={() => onStopNetwork(network.id)}
                disabled={isLoading}
                title="Stop All"
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCw size={16} />}
              onClick={() => onRestartNetwork(network.id)}
              disabled={isLoading || isStopped}
              title="Restart All"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Settings size={16} />}
              onClick={() => onManageServers(network)}
              title="Manage Servers"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={() => setShowDeleteConfirm(true)}
              className="text-danger hover:bg-danger/10"
              title="Delete Network"
            />
          </div>
        </div>

        {/* Mobile Stats - Visible when collapsed on mobile */}
        {!expanded && (
          <div className="lg:hidden flex items-center justify-around px-4 pb-4 border-t border-gray-800 pt-3">
            <div className="text-center">
              <span className="text-sm font-bold text-text-light-primary dark:text-text-primary">
                {metrics?.totalPlayers ?? 0}
              </span>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Players</p>
            </div>
            <div className="text-center">
              <span className="text-sm font-bold text-text-light-primary dark:text-text-primary">
                {metrics?.averageCpuUsage?.toFixed(1) ?? '0'}%
              </span>
              <p className="text-xs text-text-light-muted dark:text-text-muted">CPU</p>
            </div>
            <div className="text-center">
              <span className="text-sm font-bold text-text-light-primary dark:text-text-primary">
                {status?.runningServers ?? 0}/{status?.totalServers ?? 0}
              </span>
              <p className="text-xs text-text-light-muted dark:text-text-muted">Online</p>
            </div>
          </div>
        )}

        {/* Expanded Server List */}
        {expanded && (
          <div className="border-t border-gray-800">
            {network.members.length === 0 ? (
              <div className="p-4 text-center text-text-light-muted dark:text-text-muted">
                No servers in this network
              </div>
            ) : (
              network.members.map((member, index) => (
                <NetworkServerRow
                  key={member.id}
                  member={member}
                  memberStatus={status?.memberStatuses?.find(s => s.serverId === member.serverId)}
                  localServer={servers.find(s => s.id === member.serverId)}
                  isLast={index === network.members.length - 1}
                  onAction={onServerAction}
                />
              ))
            )}
          </div>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          onDeleteNetwork(network.id);
          setShowDeleteConfirm(false);
        }}
        title="Delete Network"
        message={`Are you sure you want to delete "${network.name}"? This will only remove the network grouping, not the servers themselves.`}
        confirmLabel="Delete Network"
        variant="danger"
      />
    </>
  );
};
