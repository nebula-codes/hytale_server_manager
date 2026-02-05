import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui';
import { Users, Construction } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const PlayerDetailPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">
          {t('players.detail.title')}
        </h1>
        <p className="text-text-light-muted dark:text-text-muted mt-1">
          {t('players.detail.subtitle')}
        </p>
      </div>

      {/* Coming Soon */}
      <Card variant="glass" className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-accent-primary/20 rounded-full flex items-center justify-center mb-6">
            <Users size={40} className="text-accent-primary" />
          </div>
          <div className="flex items-center gap-2 mb-4">
            <Construction size={24} className="text-warning" />
            <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
              {t('common.coming_soon')}
            </h2>
          </div>
          <p className="text-text-light-muted dark:text-text-muted max-w-md mb-6">
            {t('players.detail.description')}
          </p>
          <button
            onClick={() => navigate('/players')}
            className="px-4 py-2 bg-accent-primary text-black rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
          >
            {t('players.detail.back')}
          </button>
        </div>
      </Card>
    </div>
  );
};
