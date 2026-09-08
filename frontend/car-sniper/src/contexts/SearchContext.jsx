import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSearchHistory, addSearchHistory } from '../utils/searchHistory';
import { getComparedCars, clearComparedCars } from '../utils/carComparison';
import { logEvent } from '../utils/analytics';
import { getCached, setCache } from '../utils/cache';
import { fetchInitialData } from '../utils/initialData';

const SearchContext = createContext(null);

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://127.0.0.1:8000');

export const SearchProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({
    make: "",
    model: "",
    minPrice: "",
    maxPrice: "15000",
    site: "both",
    minYear: "",
    maxYear: "",
    maxKm: "",
    minCc: "",
    minHp: "",
    limit: "25000",
    maxPages: "15"
  });

  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(12);
  const [sortBy, setSortBy] = useState("price-asc");

  const [sidebarFilters, setSidebarFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minYear: '',
    maxYear: '',
    maxKm: '',
    fuel: [],
    transmission: [],
    source: [],
  });

  const [searchHistory, setSearchHistory] = useState(getSearchHistory());
  const [comparedCars, setComparedCars] = useState(getComparedCars());
  const [showCompare, setShowCompare] = useState(false);
  const [siteStats, setSiteStats] = useState({});

  useEffect(() => {
    // 1. Instant hydration from client cache
    const cachedBrands = getCached('car_brands');
    if (cachedBrands && cachedBrands.length > 0) {
      setBrands(cachedBrands);
    }
    const cachedStats = getCached('site_stats');
    if (cachedStats) {
      setSiteStats(cachedStats);
    }

    // 2. Fetch deduplicated initial preloaded data
    fetchInitialData().then((d) => {
      if (!d) return;
      if (d.brands && d.brands.length > 0) {
        setBrands((prev) => (prev.length === 0 ? d.brands : prev));
        setCache('car_brands', d.brands, 86400000); // 24h
      }
      if (d.stats && d.stats.carsMonitored) {
        setSiteStats(d.stats);
        setCache('site_stats', d.stats);
      }
    });

    // 3. Background revalidation
    fetchBrands();

    setComparedCars(getComparedCars());
  }, []);

  const fetchBrands = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/brands`);
      if (response.ok) {
        const data = await response.json();
        if (data.brands && data.brands.length > 0) {
          setBrands(data.brands);
          setCache('car_brands', data.brands, 86400000);
        }
      }
    } catch (err) {
      console.error('Error loading brands:', err);
    } finally {
      setLoadingBrands(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    if (formData.make) {
      const brand = formData.make;
      const cacheKey = `models_${brand.toLowerCase().trim()}`;
      const cached = getCached(cacheKey);

      if (cached && Array.isArray(cached) && cached.length > 0) {
        setModels(cached);
        setLoadingModels(false);
      } else {
        setLoadingModels(true);
        fetch(`${API_BASE_URL}/api/models/${encodeURIComponent(brand)}`)
          .then((res) => (res.ok ? res.json() : {}))
          .then((data) => {
            if (!ignore) {
              const list = data.models || [];
              setModels(list);
              if (list.length > 0) {
                setCache(cacheKey, list, 86400000);
              }
            }
          })
          .catch((err) => {
            if (!ignore) {
              console.error('Error loading models:', err);
              setModels([]);
            }
          })
          .finally(() => {
            if (!ignore) {
              setLoadingModels(false);
            }
          });
      }
    } else {
      setModels([]);
      setLoadingModels(false);
    }

    return () => {
      ignore = true;
    };
  }, [formData.make]);

  // Sync sidebar filters from formData
  useEffect(() => {
    setSidebarFilters({
      minPrice: formData.minPrice || '',
      maxPrice: formData.maxPrice || '',
      minYear: formData.minYear || '',
      maxYear: formData.maxYear || '',
      maxKm: formData.maxKm || '',
      fuel: formData.fuel ? formData.fuel.split(',').filter(Boolean) : [],
      transmission: formData.transmission ? formData.transmission.split(',').filter(Boolean) : [],
      source: formData.site && formData.site !== 'both' ? formData.site.split(',').filter(Boolean) : [],
    });
  }, [formData.minPrice, formData.maxPrice, formData.minYear, formData.maxYear, formData.maxKm, formData.fuel, formData.transmission, formData.site]);

  const handleSearch = async (e, overrideData = null) => {
    if (e && e.preventDefault) e.preventDefault();
    setError("");
    setLoading(true);
    setResults([]);
    setCurrentPage(1);

    const searchData = overrideData || formData;

    try {
      const params = new URLSearchParams();

      if (searchData.make) params.append("make", searchData.make);
      if (searchData.model) params.append("model", searchData.model);
      if (searchData.minPrice) params.append("min_price", searchData.minPrice);
      if (searchData.maxPrice) params.append("max_price", searchData.maxPrice);
      if (searchData.minYear) params.append("min_year", searchData.minYear);
      if (searchData.maxYear) params.append("max_year", searchData.maxYear);
      if (searchData.maxKm) params.append("max_km", searchData.maxKm);
      if (searchData.fuel) params.append("fuel", searchData.fuel);
      if (searchData.transmission) params.append("transmission", searchData.transmission);
      params.append("site", searchData.site);
      params.append("limit", searchData.limit);
      params.append("max_pages", searchData.maxPages);

      const url = `${API_BASE_URL}/api/search?${params.toString()}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail ? `Eroare server: ${JSON.stringify(errorData.detail)}` : `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);

      if (searchData.make || searchData.model) {
        const urlParams = new URLSearchParams();
        if (searchData.make) urlParams.set('make', searchData.make);
        if (searchData.model) urlParams.set('model', searchData.model);
        if (searchData.maxPrice) urlParams.set('max_price', searchData.maxPrice);
        if (searchData.minYear) urlParams.set('min_year', searchData.minYear);
        if (searchData.maxYear) urlParams.set('max_year', searchData.maxYear);
        if (searchData.maxKm) urlParams.set('max_km', searchData.maxKm);
        const qs = urlParams.toString();
        const newPath = searchData.make && searchData.model
          ? `/masini/${encodeURIComponent(searchData.make)}/${encodeURIComponent(searchData.model)}${qs ? '?' + qs : ''}`
          : `/${qs ? '?' + qs : ''}`;
        navigate(newPath, { replace: true });
      }

      if (searchData.make || searchData.model) { 
        addSearchHistory({ make: searchData.make || "", model: searchData.model || "" }); 
        setSearchHistory(getSearchHistory()); 
      }

      logEvent("Search", "Performed Search", `${searchData.make || 'Any'} ${searchData.model || ''}`, Array.isArray(data.results) ? data.results.length : 0);

      if (searchData.make && searchData.model) {
        try {
          const statsRes = await fetch(`${API_BASE_URL}/api/stats/${searchData.make}/${searchData.model}`);
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            if (!statsData.error) {
              setStats(statsData);
            } else {
              setStats(null);
            }
          }
        } catch (e) {
          console.error("Failed to fetch stats", e);
          setStats(null);
        }
      } else {
        setStats(null);
      }
    } catch (err) {
      console.error("Catch Error:", err);
      setError(err.message || 'A aparut o eroare. Incearca din nou.');
    } finally {
      setLoading(false);
    }
  };

  const getSortedResults = useCallback(() => {
    const parsePrice = (p) => {
      if (typeof p === 'number') return p;
      if (typeof p === 'string') return Number(p.replace(/[^0-9.-]+/g, ""));
      return 0;
    };

    const sorted = [...results];
    switch (sortBy) {
      case "price-asc":
        return sorted.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
      case "price-desc":
        return sorted.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
      case "year-desc":
        return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      case "year-asc":
        return sorted.sort((a, b) => (a.year || 0) - (b.year || 0));
      case "km-asc":
        return sorted.sort((a, b) => (a.km || 0) - (b.km || 0));
      default:
        return sorted;
    }
  }, [results, sortBy]);

  const sortedResults = useMemo(() => getSortedResults(), [getSortedResults]);
  const indexOfLastCar = currentPage * itemsPerPage;
  const indexOfFirstCar = indexOfLastCar - itemsPerPage;
  const currentCars = sortedResults.slice(indexOfFirstCar, indexOfLastCar);

  const paginate = useCallback((pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 800, behavior: 'smooth' });
  }, []);

  const handleBrandSelect = useCallback((brand) => {
    const updated = { ...formData, make: brand, model: '' };
    setFormData(updated);
    handleSearch(null, updated);
  }, [formData]);

  const handleFilterApply = useCallback(() => {
    const updated = {
      ...formData,
      minPrice: sidebarFilters.minPrice,
      maxPrice: sidebarFilters.maxPrice,
      minYear: sidebarFilters.minYear,
      maxYear: sidebarFilters.maxYear,
      maxKm: sidebarFilters.maxKm,
      fuel: sidebarFilters.fuel.join(','),
      transmission: sidebarFilters.transmission.join(','),
      site: sidebarFilters.source.length > 0 ? sidebarFilters.source.join(',') : 'both',
    };
    setFormData(updated);
    handleSearch(null, updated);
  }, [formData, sidebarFilters]);

  const handleSearchSubmit = useCallback((e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (formData.make && formData.model) {
      const targetUrl = `/masini/${encodeURIComponent(formData.make)}/${encodeURIComponent(formData.model)}`;
      if (location.pathname === targetUrl) {
        handleSearch();
      } else {
        navigate(targetUrl);
      }
    } else {
      if (location.pathname !== "/") {
        navigate("/");
      } else {
        handleSearch();
      }
    }
  }, [formData, location.pathname, navigate, handleSearch]);

  const handleClearCompare = () => {
    clearComparedCars(); 
    setComparedCars([]); 
    setShowCompare(false);
  };

  return (
    <SearchContext.Provider
      value={{
        formData, setFormData,
        brands, models,
        loadingBrands, loadingModels,
        loading, error, results, stats,
        currentPage, setCurrentPage, itemsPerPage,
        sortBy, setSortBy,
        sidebarFilters, setSidebarFilters,
        searchHistory, setSearchHistory,
        comparedCars, setComparedCars,
        showCompare, setShowCompare,
        siteStats, setSiteStats,
        handleSearch, handleSearchSubmit,
        handleBrandSelect, handleFilterApply,
        handleClearCompare,
        sortedResults, currentCars, paginate
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => useContext(SearchContext);
