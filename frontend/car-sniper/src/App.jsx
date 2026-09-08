import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, useParams, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import SearchForm from "./components/SearchForm";
import ResultsList from "./components/ResultsList";
import AlertModal from "./components/AlertModal";
import ContactModal from "./components/ContactModal";
import AuthModal from "./components/AuthModal";
import PriceStats from "./components/PriceStats";
import Pagination from "./components/Pagination";
import SkeletonCard from "./components/SkeletonCard";
import DealOfTheDay from "./components/DealOfTheDay";
import TrustStats from "./components/TrustStats";
import BrandGrid from "./components/BrandGrid";
import FilterSidebar from "./components/FilterSidebar";
import Breadcrumbs from "./components/Breadcrumbs";
import { useLanguage } from "./LanguageContext";
import { initGA, logPageView, logEvent } from "./utils/analytics";
import { useAuth } from "./contexts/AuthContext";
import { useSearch } from "./contexts/SearchContext";
import { Sun, Moon, SlidersHorizontal } from "lucide-react";
import "./App.css";
import logo from './assets/logo.webp';

// Lazy load non-landing page routes for code splitting (recharts, etc.)
const LegalPage = React.lazy(() => import("./components/LegalPage"));
const PartnerDashboard = React.lazy(() => import("./components/PartnerDashboard"));
const DealerProfile = React.lazy(() => import("./components/DealerProfile"));
const PricingPage = React.lazy(() => import("./components/PricingPage"));
const AlertManager = React.lazy(() => import("./components/AlertManager"));


const AppContent = () => {
  const { t, lang, setLang } = useLanguage();
  const location = useLocation();
  const { make: urlMake, model: urlModel } = useParams();

  const { currentUser, setCurrentUser, isAuthOpen, setIsAuthOpen, handleLogout } = useAuth();
  const {
    formData, setFormData, brands, models, loadingBrands, loadingModels,
    loading, error, results, stats, currentPage, itemsPerPage, sortBy, setSortBy,
    sidebarFilters, setSidebarFilters,
    comparedCars, showCompare, setShowCompare, siteStats,
    handleSearch, handleSearchSubmit, handleBrandSelect, handleFilterApply,
    handleClearCompare, currentCars, paginate
  } = useSearch();

  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);
    if (savedTheme === 'dark') document.documentElement.classList.add('dark');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };




  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const qMake = queryParams.get('make');
    const qModel = queryParams.get('model');
    if (qMake && !urlMake) {
      const restored = {
        make: qMake,
        model: qModel || '',
        maxPrice: queryParams.get('max_price') || '15000',
        minYear: queryParams.get('min_year') || '',
        maxYear: queryParams.get('max_year') || '',
        maxKm: queryParams.get('max_km') || '',
        minPrice: '',
        site: 'both',
        minCc: '',
        minHp: '',
        limit: '25000',
        maxPages: '15',
      };
      setFormData(restored);
      if (qMake && qModel) {
        handleSearch(null, restored);
      }
    }
  }, [location.search]);

  useEffect(() => {
    initGA();
  }, []); // Init once on mount

  useEffect(() => {
    logPageView(location.pathname + location.search);
  }, [location]);

  useEffect(() => {
    if (urlMake && urlModel) {
      const make = decodeURIComponent(urlMake);
      const model = decodeURIComponent(urlModel);

      setFormData(prev => ({ ...prev, make, model }));
      handleSearch(null, { ...formData, make, model });
    }
  }, [urlMake, urlModel]);


  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const handleCreateAlert = useCallback(async (email) => {
    try {
      const token = localStorage.getItem('jwt_token');
      if (!token) {
        alert("Eroare de sesiune. Te rugăm să te loghezi din nou.");
        setCurrentUser(null);
        setIsAuthOpen(true);
        return;
      }

      // We don't have API_BASE_URL defined in App.jsx directly unless imported.
      // Wait, API_BASE_URL was in App.jsx but we moved it to SearchContext? Let's check where it is.
      // It's probably globally defined or I'll just use a relative path since Vercel handles it, or use import.meta.env
      const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://127.0.0.1:8000');

      const response = await fetch(`${API_URL}/api/alert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          user_email: email,
          make: formData.make,
          model: formData.model,
          min_price: parseInt(formData.minPrice) || null,
          max_price: parseInt(formData.maxPrice) || null,
          min_year: parseInt(formData.minYear) || null,
          max_year: parseInt(formData.maxYear) || null,
          max_km: parseInt(formData.maxKm) || null
        })
      });

      if (response.status === 401) {
          localStorage.removeItem('jwt_token');
          localStorage.removeItem('user_email');
          localStorage.removeItem('user_role');
          setCurrentUser(null);
          setIsAuthOpen(true);
          throw new Error("Sesiunea a expirat. Te rugăm să te conectezi din nou.");
      }

      if (!response.ok) throw new Error("Nu s-a putut salva alerta.");

      logEvent("Alert", "Created Price Alert", `${formData.make || 'Any'} ${formData.model || ''} - Max: ${formData.maxPrice}`);
      alert("Alertă salvată cu succes! Vei primi notificări pe email.");
    } catch (err) {
      console.error(err);
      alert("Eroare la salvarea alertei.");
    }
  }, [formData, setCurrentUser, setIsAuthOpen]);

  const handleAlertClick = useCallback(() => setIsAlertOpen(true), []);
  const handleFilterClose = useCallback(() => setIsFilterOpen(false), []);
  const handleAlertClose = useCallback(() => setIsAlertOpen(false), []);
  const handleContactClose = useCallback(() => setIsContactOpen(false), []);
  const handleAuthClose = useCallback(() => setIsAuthOpen(false), [setIsAuthOpen]);

  return (
    <div>
      {urlMake && urlModel && (
        <Helmet>
          <title>{`${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare - Cele mai bune prețuri | Motorbit`}</title>
          <meta name="description" content={`Găsește cele mai bune oferte pentru ${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare. Prețuri excelente și mașini verificate.`} />
          <meta property="og:title" content={`${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare - Cele mai bune prețuri | Motorbit`} />
          <meta property="og:description" content={`Găsește cele mai bune oferte pentru ${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare.`} />
          <meta property="og:type" content="website" />
          <meta property="og:url" content={`https://motorbit.ro/masini/${urlMake}/${urlModel}`} />
          <meta property="og:image" content="https://motorbit.ro/og-image.png" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={`${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare - Cele mai bune prețuri | Motorbit`} />
          <meta name="twitter:description" content={`Găsește cele mai bune oferte pentru ${decodeURIComponent(urlMake)} ${decodeURIComponent(urlModel)} de vânzare.`} />
          <meta name="twitter:image" content="https://motorbit.ro/og-image.png" />
          <link rel="canonical" href={`https://motorbit.ro/masini/${urlMake}/${urlModel}`} />
        </Helmet>
      )}
      {!urlMake && !urlModel && (
        <Helmet>
          <title>Motorbit - Găsește mașina dorită</title>
          <meta name="description" content="Caută și găsește cele mai bune mașini second hand și noi." />
          <meta property="og:title" content="Motorbit - Găsește mașina dorită" />
          <meta property="og:description" content="Caută și găsește cele mai bune mașini second hand și noi." />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://motorbit.ro" />
          <meta property="og:image" content="https://motorbit.ro/og-image.png" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Motorbit - Găsește mașina dorită" />
          <meta name="twitter:description" content="Caută și găsește cele mai bune mașini second hand și noi." />
          <meta name="twitter:image" content="https://motorbit.ro/og-image.png" />
          <link rel="canonical" href="https://motorbit.ro" />
          <script type="application/ld+json">
            {JSON.stringify({
              "@context": "https://schema.org",
              "@type": ["WebSite", "Organization"],
              "name": "Motorbit",
              "url": "https://motorbit.ro",
              "description": "Cauta si gaseste cele mai bune masini second hand si noi. Analiza de piata si scoruri de oferta pentru anunturi de pe OLX si Autovit.",
              "potentialAction": {
                "@type": "SearchAction",
                "target": "https://motorbit.ro/?make={search_term_string}",
                "query-input": "required name=search_term_string"
              }
            })}
          </script>
        </Helmet>
      )}
      <nav className="top-nav">
        <div className="nav-brand">
          <div style={{ width: '32px', height: '32px', overflow: 'hidden', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={logo} alt="Motorbit Logo" width="32" height="32" fetchPriority="high" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.8)' }} onError={(e) => e.target.parentElement.style.display = 'none'} />
          </div>
          <span>MOTORBIT</span>
        </div>
        <div className="nav-links">
          <a href="#">{t('nav', 'browse')}</a>
          <a href="#" className="partner-link" onClick={(e) => { e.preventDefault(); setIsContactOpen(true); }}>{t('nav', 'partner')}</a>

          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {(currentUser.role === 'admin' || currentUser.role === 'dealer') && (
                <a href="/partner-dashboard" style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>Dashboard</a>
              )}
              <span style={{ color: 'var(--text-secondary)' }}>{t('nav', 'greeting', { email: currentUser.email })}</span>
              <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--border-shell)', color: '#ef4444', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                Logout
              </button>
            </div>
          ) : (
            <button onClick={() => setIsAuthOpen(true)} className="login-btn">{t('nav', 'account')}</button>
          )}

          <div className="lang-selector" style={{ display: 'flex', gap: '8px', marginLeft: '1rem', alignItems: 'center' }}>
            <button onClick={() => setLang('ro')} style={{ background: 'none', border: 'none', color: lang === 'ro' ? 'var(--primary-color)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: lang === 'ro' ? 'bold' : 'normal' }}>RO</button>
            <span style={{ color: 'var(--text-secondary)' }}>|</span>
            <button onClick={() => setLang('en')} style={{ background: 'none', border: 'none', color: lang === 'en' ? 'var(--primary-color)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: lang === 'en' ? 'bold' : 'normal' }}>EN</button>
          </div>

          <button onClick={toggleTheme} className="theme-toggle-btn" style={{ marginLeft: '1rem' }} aria-label="Toggle Theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </nav>

      <main id="main-content">
        <div className="hero-section">
        <div className="container">
          <h1 className="hero-title">{t('hero', 'title')}</h1>
          <p className="hero-subtitle">
            {t('hero', 'subtitle')}
          </p>
          <div className="hero-features">
            {t('hero', 'features')}
          </div>
        </div>
      </div>

      <TrustStats stats={siteStats} />

      <div className="container">
        <SearchForm
          formData={formData}
          setFormData={setFormData}
          brands={brands}
          models={models}
          loadingBrands={loadingBrands}
          loadingModels={loadingModels}
          onSubmit={handleSearchSubmit}
          loading={loading}
          onAlertClick={handleAlertClick}
        />
      </div>
      <Breadcrumbs />

      <div className="container">

        <AlertModal
          isOpen={isAlertOpen}
          onClose={handleAlertClose}
          onSubmit={handleCreateAlert}
          searchParams={formData}
        />

        <ContactModal
          isOpen={isContactOpen}
          onClose={handleContactClose}
        />

        <AuthModal
          isOpen={isAuthOpen}
          onClose={handleAuthClose}
          onLoginSuccess={(email, token, role) => setCurrentUser({ email, role })}
        />

        {!loading && !error && results.length === 0 && !formData.make && (
          <>
            <BrandGrid onBrandSelect={handleBrandSelect} />
            <DealOfTheDay />
          </>
        )}

        {error && <div className="error-message" role="alert">{error}</div>}


        <div id="results-area">
          {loading ? (
            <div className="results-grid">
              {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : (
            <>
              {results.length > 0 && (
                <div className="results-layout">
                  <FilterSidebar
                    filters={sidebarFilters}
                    onFilterChange={setSidebarFilters}
                    onApply={handleFilterApply}
                    isOpen={isFilterOpen}
                    onClose={handleFilterClose}
                  />
                  <div className="results-main">
                    <div className="results-header">
                      <span className="results-count">
                        {t('results', 'foundPrefix')} <strong>{results.length}</strong> {t('results', 'foundSuffix')}
                      </span>
                      <div className="sort-controls">
                        <button
                          className="filter-toggle-btn"
                          onClick={() => setIsFilterOpen(true)}
                          aria-label="Open filters"
                        >
                          <SlidersHorizontal size={18} />
                          Filtre
                        </button>
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="sort-select"
                        >
                          <option value="price-asc">{t('results', 'sortPriceAsc')}</option>
                          <option value="price-desc">{t('results', 'sortPriceDesc')}</option>
                          <option value="year-desc">{t('results', 'sortYearDesc')}</option>
                          <option value="year-asc">{t('results', 'sortYearAsc')}</option>
                          <option value="km-asc">{t('results', 'sortKmAsc')}</option>
                        </select>
                      </div>
                    </div>
                    {stats && <PriceStats stats={stats} currentSearch={formData} />}
                    <ResultsList results={currentCars} />
                    <Pagination
                      carsPerPage={itemsPerPage}
                      totalCars={results.length}
                      paginate={paginate}
                      currentPage={currentPage}
                    />
                  </div>
                </div>
              )}

              {results.length === 0 && !error && formData.make && (
                <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                  <h3>{t('results', 'noResultsTitle')}</h3>
                  <p>{t('results', 'noResultsSubtitle')}</p>
                </div>
              )}
            </>
          )}
        </div>

        {showCompare && comparedCars.length >= 2 && (
        <div className="container" style={{ marginTop: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Car Comparison</h2>
          <div className="alerts-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  {comparedCars.map(c => <th key={c.id || c.link}>{c.title}</th>)}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Price', 'price'],
                  ['Year', 'year'],
                  ['Km', 'km'],
                  ['Fuel', 'fuel'],
                  ['Transmission', 'transmission'],
                  ['Deal Score', 'deal_score'],
                ].map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    {comparedCars.map(c => (
                      <td key={(c.id || c.link) + key}>{c[key] != null ? String(c[key]) : '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {comparedCars.length > 0 && (
        <div className="compare-bar">
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{comparedCars.length} cars selected</span>
          <div className="compare-bar-cars">
            {comparedCars.map(car => (
              <span key={car.id || car.link} className="compare-bar-car">{car.title}</span>
            ))}
          </div>
          <button className="secondary-btn" onClick={() => setShowCompare(!showCompare)}>{showCompare ? "Hide" : "Compare"}</button>
          <button className="filter-clear-btn" onClick={handleClearCompare}>Clear</button>
        </div>
      )}
      </div>
      </main>
      <footer className="site-footer">
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '1rem' }}>
             <a href="/termeni" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{t('legal', 'termsTitle')}</a>
             <a href="/confidentialitate" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{t('legal', 'privacyTitle')}</a>
          </div>
          <p>{t('footer', null, { year: new Date().getFullYear() })}</p>
        </footer>
    </div>
  );
};

const App = () => {
  return (
    <React.Suspense fallback={<div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>Se încarcă...</div>}>
      <Routes>
        <Route path="/" element={<AppContent />} />
        <Route path="/masini/:make/:model" element={<AppContent />} />
        <Route path="/termeni" element={<div><nav className="top-nav"><div className="nav-brand"><a href="/" style={{textDecoration: 'none', color: 'inherit'}}><span>M</span> MOTORBIT</a></div></nav><main id="main-content"><LegalPage type="terms" /></main></div>} />
        <Route path="/confidentialitate" element={<div><nav className="top-nav"><div className="nav-brand"><a href="/" style={{textDecoration: 'none', color: 'inherit'}}><span>M</span> MOTORBIT</a></div></nav><main id="main-content"><LegalPage type="privacy" /></main></div>} />
        <Route path="/partner-dashboard" element={<main id="main-content"><PartnerDashboard /></main>} />
        <Route path="/pricing" element={<div><nav className="top-nav"><div className="nav-brand"><a href="/" style={{textDecoration: 'none', color: 'inherit'}}><span>M</span> MOTORBIT</a></div></nav><main id="main-content"><PricingPage /></main></div>} />
        <Route path="/dealer/:email" element={<div><nav className="top-nav"><div className="nav-brand"><a href="/" style={{textDecoration: 'none', color: 'inherit'}}><span>M</span> MOTORBIT</a></div></nav><main id="main-content"><DealerProfile /></main></div>} />
        <Route path="/alerts" element={<div><nav className="top-nav"><div className="nav-brand"><a href="/" style={{textDecoration: 'none', color: 'inherit'}}><span>M</span> MOTORBIT</a></div></nav><main id="main-content"><AlertManager /></main></div>} />
        <Route path="*" element={
          <main id="main-content" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'DM Sans, sans-serif' }}>
            <Helmet><title>404 - Pagina nu a fost gasita | Motorbit</title><meta name="robots" content="noindex" /></Helmet>
            <h1 style={{ fontSize: '4rem', fontWeight: 800, margin: 0, color: 'var(--primary-color)' }}>404</h1>
            <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', margin: '1rem 0' }}>Pagina nu a fost gasita</p>
            <a href="/" style={{ color: 'var(--primary-color)', fontWeight: 600, textDecoration: 'none', marginTop: '1rem' }}>Inapoi acasa</a>
          </main>
        } />
      </Routes>
    </React.Suspense>
  );
};

export default App;