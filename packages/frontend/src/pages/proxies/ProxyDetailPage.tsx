import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input, Switch, Select, SelectOption } from '../../components/ui';
import { ArrowLeft, Save, Play, Square, RotateCw, Terminal } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../stores/toastStore';
import { PERMISSIONS } from '../../types';
import { usePermission } from '../../hooks/usePermission';

type NetworkType = 'logical' | 'proxy';

type ProxyConfig = {
  startOrder?: 'proxy_first' | 'backends_first';
  javaPath?: string;
  jvmArgs?: string;
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  proxySecret?: string;
  autoInstallBridge?: boolean;
  metricsPort?: number;
};

type Network = {
  id: string;
  name: string;
  description?: string;
  networkType: NetworkType;
  proxyServerId?: string;
  proxyConfig?: string | ProxyConfig | null;
  color?: string;
  members: {
    id: string;
    serverId: string;
    role: string;
    sortOrder: number;
    server: { id: string; name: string; status: string };
  }[];
};

type NetworkStatus = {
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'partial';
  memberStatuses: {
    serverId: string;
    status: string;
  }[];
};

const startOrderOptions: SelectOption[] = [
  { label: 'Backends first', value: 'backends_first' },
  { label: 'Proxy first', value: 'proxy_first' },
];

export const ProxyDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const canUpdate = usePermission(PERMISSIONS.SERVERS_UPDATE);

  const [network, setNetwork] = useState<Network | null>(null);
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [form, setForm] = useState<ProxyConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const parsedConfig = useMemo<ProxyConfig>(() => {
    if (!network?.proxyConfig) return {};
    if (typeof network.proxyConfig === 'string') {
      try {
        return JSON.parse(network.proxyConfig) as ProxyConfig;
      } catch {
        return {};
      }
    }
    return network.proxyConfig || {};
  }, [network]);

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [net, netStatus] = await Promise.all([
          api.getNetwork<Network>(id),
          api.getNetworkStatus<NetworkStatus>(id),
        ]);
        setNetwork(net);
        setStatus(netStatus);
        setForm({
          startOrder: parsedConfig.startOrder || 'backends_first',
          bindAddress: parsedConfig.bindAddress || '0.0.0.0',
          bindPort: parsedConfig.bindPort || 45585,
          publicAddress: parsedConfig.publicAddress || '',
          publicPort: parsedConfig.publicPort || parsedConfig.bindPort || 45585,
          javaPath: parsedConfig.javaPath || 'java',
          jvmArgs: parsedConfig.jvmArgs || '',
          proxySecret: parsedConfig.proxySecret || '',
          autoInstallBridge: parsedConfig.autoInstallBridge !== false,
          metricsPort: parsedConfig.metricsPort ?? 0,
        });
      } catch (error: any) {
        toast.error(t('networks.toast.load_failed', { defaultValue: 'Failed to load proxy' }), error?.message);
        navigate('/networks');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, t, toast, parsedConfig]);

  const handleChange = (field: keyof ProxyConfig, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateNetwork(id, {
        proxyConfig: {
          ...form,
          publicPort: form.publicPort || form.bindPort,
        },
      });
      toast.success(t('networks.toast.proxy_saved', { defaultValue: 'Proxy settings saved' }));
    } catch (error: any) {
      toast.error(t('networks.toast.save_failed', { defaultValue: 'Failed to save proxy settings' }), error?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.startNetwork(id);
      toast.success(t('networks.toast.start_success', { defaultValue: 'Proxy started' }));
      const s = await api.getNetworkStatus<NetworkStatus>(id);
      setStatus(s);
    } catch (error: any) {
      toast.error(t('networks.toast.start_failed', { defaultValue: 'Failed to start proxy' }), error?.message);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setStopping(true);
    try {
      await api.stopNetwork(id);
      toast.success(t('networks.toast.stop_success', { defaultValue: 'Proxy stopped' }));
      const s = await api.getNetworkStatus<NetworkStatus>(id);
      setStatus(s);
    } catch (error: any) {
      toast.error(t('networks.toast.stop_failed', { defaultValue: 'Failed to stop proxy' }), error?.message);
    } finally {
      setStopping(false);
    }
  };

  if (loading || !network) {
    return (
      <div className="p-6">
        <div className="animate-pulse h-6 w-48 bg-gray-700 rounded mb-4" />
        <div className="animate-pulse h-10 w-full bg-gray-800 rounded" />
      </div>
    );
  }

  const isRunning = status?.status === 'running';

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
              {network.name} (Proxy)
            </h1>
            <p className="text-text-light-muted dark:text-text-muted text-sm">
              {network.description || t('networks.detail.proxy.subtitle', { defaultValue: 'Proxy network settings' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isRunning ? 'success' : 'default'}>
            {status?.status || 'unknown'}
          </Badge>
          <Link to={`/console`}>
            <Button variant="secondary" size="sm" icon={<Terminal size={16} />}>
              {t('console.title')}
            </Button>
          </Link>
          <Button
            variant={isRunning ? 'danger' : 'primary'}
            size="sm"
            icon={isRunning ? <Square size={16} /> : <Play size={16} />}
            onClick={isRunning ? handleStop : handleStart}
            disabled={starting || stopping}
          >
            {isRunning ? t('common.stop') : t('common.start')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCw size={16} />}
            onClick={() => api.restartNetwork(id!)}
            disabled={starting || stopping}
          >
            {t('common.restart')}
          </Button>
        </div>
      </div>

      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('networks.detail.proxy.config_title', { defaultValue: 'Proxy Configuration' })}</CardTitle>
          <CardDescription>{t('networks.detail.proxy.config_subtitle', { defaultValue: 'Fields are written to proxy.yml on start' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Bind Address"
              value={form.bindAddress || ''}
              onChange={e => handleChange('bindAddress', e.target.value)}
            />
            <Input
              label="Bind Port"
              type="number"
              value={form.bindPort ?? 45585}
              onChange={e => handleChange('bindPort', Number(e.target.value))}
            />
            <Input
              label="Public Address"
              value={form.publicAddress || ''}
              onChange={e => handleChange('publicAddress', e.target.value)}
              placeholder="example.com"
            />
            <Input
              label="Public Port"
              type="number"
              value={form.publicPort ?? form.bindPort ?? 45585}
              onChange={e => handleChange('publicPort', Number(e.target.value))}
            />
            <Input
              label="Metrics Port (0 = auto)"
              type="number"
              value={form.metricsPort ?? 0}
              onChange={e => handleChange('metricsPort', Number(e.target.value))}
            />
            <Select
              label="Start Order"
              value={form.startOrder || 'backends_first'}
              onChange={val => handleChange('startOrder', val as ProxyConfig['startOrder'])}
              options={startOrderOptions}
            />
            <Input
              label="Java Path"
              value={form.javaPath || 'java'}
              onChange={e => handleChange('javaPath', e.target.value)}
            />
            <Input
              label="JVM Args"
              value={form.jvmArgs || ''}
              onChange={e => handleChange('jvmArgs', e.target.value)}
              placeholder="-Xms512M -Xmx1024M"
            />
            <Input
              label="Proxy Secret"
              value={form.proxySecret || ''}
              onChange={e => handleChange('proxySecret', e.target.value)}
              placeholder="Leave blank to keep current"
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">Auto-install Bridge</p>
                <p className="text-xs text-text-light-muted dark:text-text-muted">Copy bridge jars to backends on start</p>
              </div>
              <Switch
                checked={form.autoInstallBridge !== false}
                onCheckedChange={(checked) => handleChange('autoInstallBridge', checked)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setForm(parsedConfig)}>{t('common.reset')}</Button>
            <Button variant="primary" icon={<Save size={16} />} onClick={handleSave} disabled={!canUpdate || saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('networks.detail.proxy.backends', { defaultValue: 'Backends' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {network.members.filter(m => m.role !== 'proxy').map(member => (
            <div key={member.id} className="flex items-center justify-between bg-primary-bg-secondary rounded-lg px-3 py-2">
              <div className="flex flex-col">
                <span className="font-medium">{member.server.name}</span>
                <span className="text-xs text-text-light-muted dark:text-text-muted">{member.serverId}</span>
              </div>
              <Badge variant={member.server.status === 'running' ? 'success' : 'default'}>
                {member.server.status}
              </Badge>
            </div>
          ))}
          {network.members.filter(m => m.role !== 'proxy').length === 0 && (
            <p className="text-text-light-muted dark:text-text-muted text-sm">
              {t('networks.detail.proxy.no_backends', { defaultValue: 'No backend servers linked yet.' })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProxyDetailPage;
