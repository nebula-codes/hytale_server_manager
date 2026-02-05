import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter, Button, Badge } from '../ui';
import { Plus, Minus, Server, Users } from 'lucide-react';
import type { NetworkWithMembers } from '../../types';

interface UngroupedServer {
  id: string;
  name: string;
  status: string;
}

interface ManageNetworkServersModalProps {
  isOpen: boolean;
  onClose: () => void;
  network: NetworkWithMembers;
  ungroupedServers: UngroupedServer[];
  onAddServer: (networkId: string, serverId: string, role?: string) => Promise<void>;
  onRemoveServer: (networkId: string, serverId: string) => Promise<void>;
  isLoading?: boolean;
}

export const ManageNetworkServersModal = ({
  isOpen,
  onClose,
  network,
  ungroupedServers,
  onAddServer,
  onRemoveServer,
  isLoading,
}: ManageNetworkServersModalProps) => {
  const { t } = useTranslation();
  const [addingServerId, setAddingServerId] = useState<string | null>(null);
  const [removingServerId, setRemovingServerId] = useState<string | null>(null);

  const handleAddServer = async (serverId: string) => {
    setAddingServerId(serverId);
    try {
      // Default role based on network type
      const role = network.networkType === 'proxy' ? 'backend' : 'member';
      await onAddServer(network.id, serverId, role);
    } finally {
      setAddingServerId(null);
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    setRemovingServerId(serverId);
    try {
      await onRemoveServer(network.id, serverId);
    } finally {
      setRemovingServerId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge variant="success" size="sm">{t('networks.manage.status.running')}</Badge>;
      case 'stopped':
        return <Badge variant="default" size="sm">{t('networks.manage.status.stopped')}</Badge>;
      case 'starting':
        return <Badge variant="warning" size="sm">{t('networks.manage.status.starting')}</Badge>;
      case 'stopping':
        return <Badge variant="warning" size="sm">{t('networks.manage.status.stopping')}</Badge>;
      default:
        return <Badge variant="default" size="sm">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'proxy':
        return <Badge variant="info" size="sm">{t('networks.manage.role.proxy')}</Badge>;
      case 'backend':
        return <Badge variant="warning" size="sm">{t('networks.manage.role.backend')}</Badge>;
      default:
        return <Badge variant="default" size="sm">{t('networks.manage.role.member')}</Badge>;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('networks.manage.title', { name: network.name })}
      size="lg"
    >
      <div className="space-y-6">
        {/* Current Members Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users size={18} className="text-accent-primary" />
            <h3 className="font-medium text-text-light-primary dark:text-text-primary">
              {t('networks.manage.current_members', { count: network.members.length })}
            </h3>
          </div>

          {network.members.length === 0 ? (
            <div className="text-center py-6 text-text-muted bg-gray-800/50 rounded-lg">
              {t('networks.manage.empty')}
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {network.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-text-muted" />
                    <div>
                      <span className="text-text-light-primary dark:text-text-primary">
                        {member.server.name}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        {getRoleBadge(member.role)}
                        {getStatusBadge(member.server.status)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Minus size={14} />}
                    onClick={() => handleRemoveServer(member.serverId)}
                    disabled={isLoading || removingServerId === member.serverId}
                    className="text-danger hover:bg-danger/10"
                  >
                    {removingServerId === member.serverId ? t('common.deleting') : t('common.remove')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-700" />

        {/* Available Servers Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Plus size={18} className="text-success" />
            <h3 className="font-medium text-text-light-primary dark:text-text-primary">
              {t('networks.manage.available', { count: ungroupedServers.length })}
            </h3>
          </div>

          {ungroupedServers.length === 0 ? (
            <div className="text-center py-6 text-text-muted bg-gray-800/50 rounded-lg">
              {t('networks.manage.empty_available')}
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {ungroupedServers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-text-muted" />
                    <div>
                      <span className="text-text-light-primary dark:text-text-primary">
                        {server.name}
                      </span>
                      <div className="mt-1">
                        {getStatusBadge(server.status)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus size={14} />}
                    onClick={() => handleAddServer(server.id)}
                    disabled={isLoading || addingServerId === server.id}
                    className="text-success hover:bg-success/10"
                  >
                    {addingServerId === server.id ? t('common.loading') : t('common.add')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
