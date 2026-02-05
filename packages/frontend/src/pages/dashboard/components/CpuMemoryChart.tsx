import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../../../components/ui';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

interface CpuMemoryChartProps {
  data: {
    timestamps: string[];
    cpu: number[];
    memory: number[];
  };
  range: '1h' | '24h' | '7d' | '30d';
  onRangeChange: (range: '1h' | '24h' | '7d' | '30d') => void;
  loading?: boolean;
}

export const CpuMemoryChart = ({ data, range, onRangeChange, loading }: CpuMemoryChartProps) => {
  const { t } = useTranslation();
  const chartData = data.timestamps.map((timestamp, index) => ({
    time: timestamp,
    cpu: data.cpu[index],
    memory: data.memory[index],
  }));

  const formatTime = (value: string) => {
    const date = new Date(value);
    switch (range) {
      case '1h':
        return format(date, 'HH:mm');
      case '24h':
        return format(date, 'HH:mm');
      case '7d':
        return format(date, 'EEE');
      case '30d':
        return format(date, 'MMM d');
      default:
        return format(date, 'HH:mm');
    }
  };

  const ranges: Array<{ value: '1h' | '24h' | '7d' | '30d'; label: string }> = [
    { value: '1h', label: '1h' },
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
  ];

  return (
    <Card variant="glass">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('dashboard.charts.cpu_memory_title')}</CardTitle>
          <div className="flex gap-1">
            {ranges.map((r) => (
              <Button
                key={r.value}
                variant={range === r.value ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onRangeChange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-64 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('dashboard.charts.loading')}
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('dashboard.charts.no_data')}
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatTime}
                  stroke="#6B7280"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  stroke="#6B7280"
                  fontSize={12}
                  tickLine={false}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                  }}
                  labelFormatter={(value) => format(new Date(value), 'PPp')}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(1)}%`,
                    name === 'cpu' ? 'CPU' : 'Memory',
                  ]}
                />
                <Legend
                  formatter={(value) => (value === 'cpu' ? t('dashboard.charts.cpu_legend') : t('dashboard.charts.memory_legend'))}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#06B6D4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
