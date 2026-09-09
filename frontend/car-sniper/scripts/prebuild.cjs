const fs = require('fs');
const path = require('path');

// Target active deployment domain
const API_BASE = process.env.VITE_API_URL || 'https://car-sniper.vercel.app';

const SPECIAL_BRAND_CASES = {
    'bmw': 'BMW',
    'vw': 'VW',
    'volkswagen': 'Volkswagen',
    'mercedes': 'Mercedes-Benz',
    'mercedes-benz': 'Mercedes-Benz',
    'mg': 'MG',
    'gmc': 'GMC',
    'acura': 'Acura',
    'alfa romeo': 'Alfa Romeo',
    'aston martin': 'Aston Martin',
    'land rover': 'Land Rover',
    'range rover': 'Range Rover',
    'rolls-royce': 'Rolls-Royce',
    'seat': 'SEAT',
    'fiat': 'FIAT'
};

function formatBrand(name) {
    const lower = name.toLowerCase().trim();
    if (SPECIAL_BRAND_CASES[lower]) return SPECIAL_BRAND_CASES[lower];
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function getPreloadedBrands() {
    const catalogPaths = [
        path.join(__dirname, '..', '..', 'backend', 'autovit_catalog.json'),
        path.join(__dirname, '..', '..', '..', 'backend', 'autovit_catalog.json'),
        path.join(process.cwd(), 'backend', 'autovit_catalog.json')
    ];
    for (const p of catalogPaths) {
        if (fs.existsSync(p)) {
            try {
                const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
                const brands = Object.keys(raw).map(formatBrand);
                return Array.from(new Set(brands)).sort();
            } catch (err) {
                console.warn('Error reading autovit_catalog.json:', err.message);
            }
        }
    }
    // Fallback seed brands
    return [
        'Abarth', 'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'BMW', 'Bentley',
        'Chevrolet', 'Chrysler', 'Citroen', 'Dacia', 'Daewoo', 'Dodge', 'FIAT',
        'Ferrari', 'Ford', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep',
        'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Maserati', 'Mazda',
        'Mercedes-Benz', 'MINI', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot',
        'Porsche', 'Renault', 'Rolls-Royce', 'SEAT', 'Skoda', 'Smart',
        'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
    ];
}

async function fetchData() {
    const targetPath = path.join(__dirname, '..', 'public', 'initial-data.json');
    let existingData = null;
    if (fs.existsSync(targetPath)) {
        try {
            existingData = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        } catch { /* ignore parse error */ }
    }

    const initialData = {
        brands: getPreloadedBrands(),
        deals: [],
        stats: {}
    };

    // Fetch live deals from production API
    try {
        const dealsRes = await fetch(`${API_BASE}/api/deals/top`, { signal: AbortSignal.timeout(8000) });
        if (dealsRes.ok) {
            const j = await dealsRes.json();
            if (Array.isArray(j.results) && j.results.length > 0) {
                // Ensure scores are properly normalized integers
                initialData.deals = j.results.map(deal => {
                    if (deal && deal.deal_score != null) {
                        const raw = Number(deal.deal_score);
                        const normalized = (raw > 0 && raw <= 10) ? Math.round(raw * 10) : Math.round(raw);
                        return { ...deal, deal_score: normalized };
                    }
                    return deal;
                });
            }
        }
    } catch (e) {
        console.log('Deals live fetch skipped/timeout:', e.message);
    }

    // Preserve existing valid non-seed deals if live fetch timed out
    if ((!initialData.deals || initialData.deals.length === 0) && existingData && Array.isArray(existingData.deals) && existingData.deals.length > 0) {
        const nonSeedDeals = existingData.deals.filter(d => d && !String(d.id || '').startsWith('seed-deal'));
        if (nonSeedDeals.length > 0) {
            initialData.deals = nonSeedDeals;
        }
    }

    // Fetch live stats
    try {
        const statsRes = await fetch(`${API_BASE}/api/site/stats`, { signal: AbortSignal.timeout(8000) });
        if (statsRes.ok) {
            const s = await statsRes.json();
            if (s.carsMonitored) {
                initialData.stats = s;
            }
        }
    } catch (e) {
        console.log('Stats live fetch skipped/timeout:', e.message);
    }

    // Fallback stats if offline/cold start
    if (!initialData.stats || !initialData.stats.carsMonitored) {
        initialData.stats = (existingData && existingData.stats && existingData.stats.carsMonitored) ? existingData.stats : {
            carsMonitored: 134533,
            avgSavings: 2450,
            listingsToday: 13367,
            refreshRate: '5 min'
        };
    }

    // Fallback seed deals with authentic cars, matching CDN images, and 0-100 scores
    if (!initialData.deals || initialData.deals.length === 0) {
        initialData.deals = [
            {
                id: "deal-logan-8340",
                source: "OLX",
                title: "Dacia Logan 2 1.2 16V Laureate",
                price: "6500 €",
                currency: "EUR",
                year: 2017,
                km: 57000,
                fuel: "Benzină",
                deal_score: 98,
                peer_avg_price: 7800,
                peer_avg_km: 115000,
                price_diff: 1300,
                link: "https://www.olx.ro/d/oferta/vand-dacia-logan-2-IDkFQd0.html",
                image: "https://frankfurt.apollo.olxcdn.com:443/v1/files/fwzc2zq98he42-RO/image;s=1000x750;q=90"
            },
            {
                id: "deal-kuga-c245",
                source: "Autovit",
                title: "Ford Kuga 2.5 Duratec FHEV Titanium",
                price: "18530 €",
                currency: "EUR",
                year: 2022,
                km: 109082,
                fuel: "Hibrid",
                deal_score: 95,
                peer_avg_price: 22100,
                peer_avg_km: 120000,
                price_diff: 3570,
                link: "https://www.autovit.ro/autoturisme/anunt/ford-kuga-ver-2-5-duratec-fhev-titanium-ID7HOcXo.html",
                image: "https://ireland.apollo.olxcdn.com/v1/files/l8q8p0vch6013-AUTOVITRO/image;s=1000x750;q=90"
            },
            {
                id: "deal-3008-9633",
                source: "OLX",
                title: "Peugeot 3008 1.2 PureTech Allure",
                price: "11990 €",
                currency: "EUR",
                year: 2018,
                km: 98500,
                fuel: "Benzină",
                deal_score: 94,
                peer_avg_price: 14500,
                peer_avg_km: 130000,
                price_diff: 2510,
                link: "https://www.olx.ro/d/oferta/peugeot-3008-1-2-benzina-130-cp-IDkvbWn.html",
                image: "https://frankfurt.apollo.olxcdn.com:443/v1/files/pmyh3n26rfdo3-RO/image;s=1000x750;q=90"
            },
            {
                id: "deal-gla-f1db",
                source: "Autovit",
                title: "Mercedes-Benz GLA 200 CDI Progressive",
                price: "25990 €",
                currency: "EUR",
                year: 2020,
                km: 16070,
                fuel: "Diesel",
                deal_score: 92,
                peer_avg_price: 29800,
                peer_avg_km: 65000,
                price_diff: 3810,
                link: "https://www.autovit.ro/autoturisme/anunt/mercedes-benz-gla-ID7HM7MM.html",
                image: "https://ireland.apollo.olxcdn.com/v1/files/edvqmfh1fm4n-AUTOVITRO/image;s=1000x750;q=90"
            }
        ];
    }

    fs.writeFileSync(targetPath, JSON.stringify(initialData));
    console.log(`Preloaded: ${initialData.brands.length} brands, ${initialData.deals.length} deals, stats ready.`);
}

fetchData();
