import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui';

interface ServerStatusChartProps {
  statusDistribution: Record<string, number>;
  loading?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#10B981',
  stopped: '#6B7280',
  starting: '#F59E0B',
  stopping: '#EF4444',
  restarting: '#06B6D4',
  error: '#DC2626',
};

export const ServerStatusChart = ({ statusDistribution, loading }: ServerStatusChartProps) => {
  const { t } = useTranslation();

  const STATUS_LABELS: Record<string, string> = {
    running: t('dashboard.status_chart.status.running'),
    stopped: t('dashboard.status_chart.status.stopped'),
    starting: t('dashboard.status_chart.status.starting'),
    stopping: t('dashboard.status_chart.status.stopping'),
    restarting: t('dashboard.status_chart.status.restarting'),
    error: t('dashboard.status_chart.status.error'),
  };

  const data = Object.entries(statusDistribution)
    .filter(([_, count]) => count > 0)
    .map(([status, count]) => ({
      name: STATUS_LABELS[status] || status,
      value: count,
      status,
    }));

  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (loading) {
    return (
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('dashboard.status_chart.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('common.loading')}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (total === 0) {
    return (
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('dashboard.status_chart.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('dashboard.status_chart.empty')}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle>{t('dashboard.status_chart.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={60}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={STATUS_COLORS[entry.status] || '#6B7280'}
                    stroke="transparent"
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(17, 24, 39, 0.95)',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F9FAFB',
                }}
                formatter={(value, name) => [
                  t('dashboard.status_chart.tooltip.count', {
                    count: Number(value),
                  }),
                  String(name),
                ]}
              />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
                formatter={(value) => (
                  <span className="text-text-light-primary dark:text-text-primary text-sm">
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="text-center text-sm text-text-light-muted dark:text-text-muted mt-2">
          {t('dashboard.status_chart.total', { count: total })}
        </div>
      </CardContent>
    </Card>
  );
};
