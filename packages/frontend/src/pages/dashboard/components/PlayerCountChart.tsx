import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui';
import { format } from 'date-fns';

interface PlayerCountChartProps {
  data: {
    timestamps: string[];
    players: number[];
  };
  range: '1h' | '24h' | '7d' | '30d';
  loading?: boolean;
}

export const PlayerCountChart = ({ data, range, loading }: PlayerCountChartProps) => {
  const { t } = useTranslation();
  const chartData = data.timestamps.map((timestamp, index) => ({
    time: timestamp,
    players: data.players[index],
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

  const maxPlayers = Math.max(...data.players, 1);

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle>{t('dashboard.charts.player_activity_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('dashboard.charts.loading')}
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-text-light-muted dark:text-text-muted">
            {t('dashboard.charts.player_activity_empty')}
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="playerGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                  domain={[0, Math.ceil(maxPlayers * 1.1)]}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                  }}
                  labelFormatter={(value) => format(new Date(value), 'PPp')}
                  formatter={(value) => [
                    t('dashboard.charts.player_activity_tooltip_value', { count: Number(value) }),
                    t('dashboard.charts.player_activity_series'),
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="players"
                  stroke="#10B981"
                  strokeWidth={2}
                  fill="url(#playerGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
