import React, { useState, useEffect } from 'react';
import CarCard from './CarCard';
import SkeletonCard from './SkeletonCard';
import { useLanguage } from '../LanguageContext';
import { getCached, setCache } from '../utils/cache';
import { fetchInitialData } from '../utils/initialData';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://127.0.0.1:8000');

const DealOfTheDay = () => {
    const { t } = useLanguage();
    const [deals, setDeals] = useState(() => getCached('top_deals') || []);
    const [loading, setLoading] = useState(() => (getCached('top_deals') || []).length === 0);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const fetchDeals = async () => {
            try {
                // 1. Check preloaded initial-data.json (deduplicated)
                try {
                    const initData = await fetchInitialData();
                    if (initData && Array.isArray(initData.deals) && initData.deals.length > 0) {
                        if (isMounted) {
                            setDeals(initData.deals);
                            setLoading(false);
                            setCache('top_deals', initData.deals);
                        }
                        return;
                    }
                } catch { /* fall through to API */ }

                // 2. Check local client cache
                const cached = getCached('top_deals');
                if (cached && cached.length > 0) {
                    if (isMounted) {
                        setDeals(cached);
                        setLoading(false);
                    }
                    return;
                }

                if (isMounted) {
                    setLoading(true);
                    setError(null);
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await fetch(`${API_BASE_URL}/api/deals/top`, {
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const data = await response.json();
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    if (isMounted) {
                        setDeals(data.results || []);
                        setCache('top_deals', data.results || []);
                    }
                } catch (fetchErr) {
                    clearTimeout(timeoutId);
                    if (fetchErr.name === 'AbortError') {
                        const stale = getCached('top_deals');
                        if (stale && stale.length > 0 && isMounted) {
                            setDeals(stale);
                            return;
                        }
                    }
                    throw fetchErr;
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Failed to fetch top deals:", err);
                    setError(err.message);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchDeals();

        return () => {
            isMounted = false;
        };
    }, []);

    if (loading) {
        return (
            <div className="deals-section-shell">
                <div className="deals-section-core">
                    <div className="deals-section-header">
                        <h2 className="deals-section-title">
                            {t('dealOfTheDay', 'title')}
                        </h2>
                        <p className="deals-section-subtitle">
                            {t('dealOfTheDay', 'loading')}
                        </p>
                    </div>
                    <div className="deals-grid">
                        {[...Array(8)].map((_, i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error || deals.length === 0) {
        return null; // Gracefully hide if error occurs or no deals are active
    }

    return (
        <div className="deals-section-shell">
            <div className="deals-section-core">
                
                {/* 1. FEATURED DEAL OF THE DAY */}
                {deals.length > 0 && (() => {
                    const top = deals[0];
                    const rawPrice = parseInt(String(top.price).replace(/\D/g, '')) || 0;
                    const displayPrice = rawPrice === 0 ? t('card', 'priceOnRequest')
                        : new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(rawPrice);
                    
                    const hasPeerAvg = top.peer_avg_price > 0;
                    const formattedPeerAvgPrice = hasPeerAvg
                        ? new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(top.peer_avg_price)
                        : '';
                        
                    const formattedSavings = top.price_diff > 0
                        ? new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(top.price_diff)
                        : '';
                    
                    // calculate price diff percentage
                    const diffPercent = hasPeerAvg && rawPrice > 0 
                        ? (((top.peer_avg_price - rawPrice) / top.peer_avg_price) * 100).toFixed(1)
                        : null;
                    
                    const isOlx = (top.link || top.url || "").includes('olx');
                    const siteName = top.subsource || top.source || (isOlx ? 'OLX' : 'Autovit');
                    
                    let dealClass = '';
                    let dealTextKey = '';
                    if (top.deal_score != null) {
                        if (top.deal_score >= 80) { dealClass = 'deal-excellent'; dealTextKey = 'excellent'; }
                        else if (top.deal_score >= 60) { dealClass = 'deal-good'; dealTextKey = 'good'; }
                        else if (top.deal_score >= 40) { dealClass = 'deal-fair'; dealTextKey = 'fair'; }
                        else { dealClass = 'deal-overpriced'; dealTextKey = 'overpriced'; }
                    }
                    
                    return (
                        <div className="dotd-featured-wrapper">
                            <div className="dotd-section-header">
                                <h2 className="dotd-section-title">
                                    <span className="dotd-title-accent"></span>
                                    {t('dealOfTheDay', 'title')}
                                </h2>
                                <span className="dotd-badge">{t('dealOfTheDay', 'badge')}</span>
                            </div>
                            
                            <div className="dotd-featured-card">
                                <div className="dotd-featured-image-col">
                                    <img
                                        src={top.image || "https://placehold.co/600x400/1e293b/cbd5e1?text=No+Image"}
                                        alt={top.title}
                                        className="dotd-featured-image"
                                        fetchPriority="high"
                                        referrerPolicy="no-referrer"
                                        onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/600x400/1e293b/cbd5e1?text=Error"; }}
                                    />
                                </div>
                                
                                <div className="dotd-featured-content-col">
                                    {top.deal_score != null && (
                                        <div className="dotd-score-header">
                                            <div className={`dotd-score-circle ${dealClass}`}>
                                                {top.deal_score}
                                            </div>
                                            <div className="dotd-score-label">
                                                <span className={`dotd-score-text ${dealClass}`}>{t('deal', dealTextKey).toUpperCase()}</span>
                                                <span className="dotd-score-subtext">{t('deal', 'scoreLabel')}</span>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <h3 className="dotd-featured-title">{top.title || top.name}</h3>
                                    <p className="dotd-featured-price">{displayPrice}</p>
                                    
                                    <table className="dotd-specs-table">
                                        <tbody>
                                            {top.year && (
                                                <tr>
                                                    <td className="spec-label">An</td>
                                                    <td className="spec-val">{top.year}</td>
                                                </tr>
                                            )}
                                            {top.km != null && top.km !== '' && (
                                                <tr>
                                                    <td className="spec-label">km</td>
                                                    <td className="spec-val">{top.km} km</td>
                                                </tr>
                                            )}
                                            {top.fuel && (
                                                <tr>
                                                    <td className="spec-label">Combustibil</td>
                                                    <td className="spec-val">{top.fuel}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                    
                                    <div className="dotd-featured-actions">
                                        <a href={top.url || top.link} target="_blank" rel="noreferrer" className="btn-navy">
                                            {t('card', 'viewDetails')}
                                        </a>
                                        <a href={top.url || top.link} target="_blank" rel="noreferrer" className="btn-outline-source">
                                            {siteName}
                                        </a>
                                    </div>
                                </div>
                                
                                <div className="dotd-market-col">
                                    <div className="market-panel">
                                        <div className="market-panel-title">
                                            {t('dealOfTheDay', 'marketTitle')} — {top.title || top.name}
                                        </div>
                                        
                                        <div className="market-stats">
                                            {hasPeerAvg && (
                                                <div className="market-stat-row">
                                                    <div className="stat-left">
                                                        <span className="stat-lbl">{t('dealOfTheDay', 'avgPrice')}</span>
                                                        <span className="stat-val">{formattedPeerAvgPrice}</span>
                                                    </div>
                                                    {diffPercent != null && (
                                                        <div className="stat-right">
                                                            <span className={`stat-diff ${top.price_diff > 0 ? 'good' : 'bad'}`}>
                                                                {top.price_diff > 0 ? `-${diffPercent}%` : `+${diffPercent}%`}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {top.peer_avg_km > 0 && (
                                                <div className="market-stat-row">
                                                    <div className="stat-left">
                                                        <span className="stat-lbl">{t('dealOfTheDay', 'avgKm')}</span>
                                                        <span className="stat-val">{new Intl.NumberFormat('ro-RO').format(top.peer_avg_km)} km</span>
                                                    </div>
                                                    <div className="stat-right">
                                                        {top.km > 0 && (() => {
                                                            const kmDiff = ((top.peer_avg_km - top.km) / top.peer_avg_km * 100).toFixed(0);
                                                            return (
                                                                <span className={`stat-diff ${kmDiff > 0 ? 'good' : 'bad'}`}>
                                                                    {kmDiff > 0 ? `-${kmDiff}%` : `+${Math.abs(kmDiff)}%`}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {top.price_diff > 0 && (
                                            <div className="market-savings-box">
                                                <div className="savings-title">{t('dealOfTheDay', 'vsPiata')}</div>
                                                <div className="savings-amount">+{formattedSavings} {t('dealOfTheDay', 'savedVsAvg')}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                            </div>
                        </div>
                    );
                })()}

                {/* 2. TOP DEALS NOW GRID */}
                {deals.length > 1 && (
                    <div className="top-deals-wrapper">
                        <div className="top-deals-header">
                            <div className="top-deals-header-left">
                                <h2 className="dotd-section-title">
                                    <span className="dotd-title-accent"></span>
                                    {t('dealOfTheDay', 'topDealsTitle')}
                                </h2>
                                <p className="top-deals-subtitle">{t('dealOfTheDay', 'topDealsSubtitle')}</p>
                            </div>
                            <div className="top-deals-header-right">
                                <a href="#results-area" className="view-all-link">{t('dealOfTheDay', 'viewAll')} &rarr;</a>
                            </div>
                        </div>
                        
                        <div className="deals-grid-v2">
                            {deals.slice(1, 9).map((car, idx) => (
                                <CarCard key={car.id || car.link || `deal-${idx}`} car={car} index={idx + 1} variant="deal" />
                            ))}
                        </div>
                    </div>
                )}
                
            </div>
        </div>
    );
};

export default DealOfTheDay;
