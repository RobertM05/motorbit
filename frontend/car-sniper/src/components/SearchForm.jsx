import React, { useState } from "react";
import PropTypes from 'prop-types';
import { useLanguage } from "../LanguageContext";

const SearchForm = ({
  formData,
  setFormData,
  brands,
  models,
  loadingBrands,
  loadingModels,
  onSubmit,
  loading,
  onAlertClick
}) => {
  const { t } = useLanguage();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const newData = { ...prev, [name]: value };
      if (name === "make") {
        newData.model = "";
        newData.generation = "";
      }

      return newData;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="search-form-shell">
      <form onSubmit={handleSubmit} className="search-form-grid">

        {/* Top Row: 4 Columns */}
        <div className="search-fields-row">
          <div className="form-group">
            <label htmlFor="search-make">{t('search', 'make')}</label>
            <select
              id="search-make"
              name="make"
              value={formData.make}
              onChange={handleChange}
              disabled={loadingBrands}
              className="form-control"
              aria-label={t('search', 'make')}
            >
              <option value="">{t('search', 'anyMake')}</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="search-model">{t('search', 'model')}</label>
            <select
              id="search-model"
              name="model"
              value={formData.model}
              onChange={handleChange}
              disabled={!formData.make || loadingModels}
              className="form-control"
              aria-label={t('search', 'model')}
            >
              <option value="">{t('search', 'anyModel')}</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="search-min-price">{t('search', 'minPrice')}</label>
            <input
              id="search-min-price"
              type="number"
              name="minPrice"
              value={formData.minPrice}
              onChange={handleChange}
              placeholder="0"
              className="form-control"
              aria-label={t('search', 'minPrice')}
            />
          </div>

          <div className="form-group">
            <label htmlFor="search-max-price">{t('search', 'maxPrice')}</label>
            <input
              id="search-max-price"
              type="number"
              name="maxPrice"
              value={formData.maxPrice}
              onChange={handleChange}
              placeholder="100000"
              className="form-control"
              aria-label={t('search', 'maxPrice')}
            />
          </div>
        </div>

        {/* Advanced Row: 4 Columns */}
        {showAdvanced && (
          <div className="search-fields-row search-fields-advanced">
            <div className="form-group">
              <label htmlFor="search-min-year">{t('search', 'minYear')}</label>
              <input
                id="search-min-year"
                type="number"
                name="minYear"
                value={formData.minYear}
                onChange={handleChange}
                placeholder="2010"
                className="form-control"
                aria-label={t('search', 'minYear')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="search-max-year">{t('search', 'maxYear')}</label>
              <input
                id="search-max-year"
                type="number"
                name="maxYear"
                value={formData.maxYear}
                onChange={handleChange}
                placeholder="2024"
                className="form-control"
                aria-label={t('search', 'maxYear')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="search-max-km">{t('search', 'maxKm')}</label>
              <input
                id="search-max-km"
                type="number"
                name="maxKm"
                value={formData.maxKm}
                onChange={handleChange}
                placeholder="200000"
                className="form-control"
                aria-label={t('search', 'maxKm')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="search-fuel">{t('filters', 'fuel')}</label>
              <select
                id="search-fuel"
                name="fuel"
                value={formData.fuel || ""}
                onChange={handleChange}
                className="form-control"
                aria-label={t('filters', 'fuel')}
              >
                <option value="">{t('filters', 'any')}</option>
                <option value="Petrol">{t('filters', 'petrol')}</option>
                <option value="Diesel">{t('filters', 'diesel')}</option>
                <option value="Hybrid">{t('filters', 'hybrid')}</option>
                <option value="Electric">{t('filters', 'electric')}</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="search-transmission">{t('filters', 'transmission')}</label>
              <select
                id="search-transmission"
                name="transmission"
                value={formData.transmission || ""}
                onChange={handleChange}
                className="form-control"
                aria-label={t('filters', 'transmission')}
              >
                <option value="">{t('filters', 'any')}</option>
                <option value="Automatic">{t('filters', 'automatic')}</option>
                <option value="Manual">{t('filters', 'manual')}</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="search-limit">{t('search', 'limit')}</label>
              <select
                id="search-limit"
                name="limit"
                value={formData.limit}
                onChange={handleChange}
                className="form-control"
                aria-label={t('search', 'limit')}
              >
                <option value="50">{t('search', 'fast')}</option>
                <option value="100">{t('search', 'normal')}</option>
                <option value="300">{t('search', 'extended')}</option>
                <option value="25000">{t('search', 'all')}</option>
              </select>
            </div>
          </div>
        )}

        {/* Action Buttons Centered Below */}
        <div className="search-actions-row">
          <button
            type="button"
            onClick={onAlertClick}
            disabled={!formData.make || !formData.model}
            className="secondary-btn"
          >
            {t('search', 'setAlert')}
          </button>

          <button
            type="submit"
            disabled={loading}
            className="submit-btn"
          >
            {loading ? t('search', 'searching') : t('search', 'searchBtn')}
            <div className="submit-btn-inner">
              &rarr;
            </div>
          </button>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="secondary-btn"
          >
            {t('search', 'advanced')}
          </button>
        </div>

      </form>
    </div>
  );
};

SearchForm.propTypes = {
    formData: PropTypes.object.isRequired,
    setFormData: PropTypes.func.isRequired,
    brands: PropTypes.array.isRequired,
    models: PropTypes.array.isRequired,
    loadingBrands: PropTypes.bool,
    loadingModels: PropTypes.bool,
    onSubmit: PropTypes.func.isRequired,
    loading: PropTypes.bool,
    onAlertClick: PropTypes.func.isRequired,
};

export default React.memo(SearchForm);
