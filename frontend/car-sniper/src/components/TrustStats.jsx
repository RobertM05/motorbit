import React from 'react';
import { Crosshair, RefreshCw, Clock } from 'lucide-react';
import PropTypes from 'prop-types';
import { useLanguage } from '../LanguageContext';

const DEFAULT_STATS = {
    carsMonitored: 0,
    avgSavings: 0,
    listingsToday: 0,
    refreshRate: '5 min',
};

const TrustStats = ({ stats }) => {
    const { t } = useLanguage();
    const s = { ...DEFAULT_STATS, ...stats };

    const items = [
        { icon: Crosshair, value: s.carsMonitored.toLocaleString('ro-RO'), labelKey: 'carsMonitored' },
        { icon: RefreshCw, value: s.listingsToday.toLocaleString('ro-RO'), labelKey: 'listingsToday' },
        { icon: Clock, value: s.refreshRate, labelKey: 'refreshRate' },
    ];

    return (
        <section className="trust-stats-section">
            <div className="trust-stats-container">
                {items.map((item, i) => {
                    const Icon = item.icon;
                    return (
                    <div key={i} className="trust-stat-item">
                        {Icon && <Icon size={20} className="trust-stat-icon" />}
                        <p className="trust-stat-value">{item.value}</p>
                        <p className="trust-stat-label">{t('trustStats', item.labelKey)}</p>
                    </div>
                    );
                })}
            </div>
        </section>
    );
};

TrustStats.propTypes = {
    stats: PropTypes.shape({
        carsMonitored: PropTypes.number,
        avgSavings: PropTypes.number,
        listingsToday: PropTypes.number,
        refreshRate: PropTypes.string,
    }),
};

export default TrustStats;
