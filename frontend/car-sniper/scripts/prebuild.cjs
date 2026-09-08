const fs = require('fs');
const path = require('path');

// Target active deployment domain
const API_BASE = process.env.VITE_API_URL || 
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://car-sniper.vercel.app');

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
    const initialData = {
        brands: getPreloadedBrands(),
        deals: [],
        stats: {}
    };

    // Fetch live deals
    try {
        const dealsRes = await fetch(`${API_BASE}/api/deals/top`, { signal: AbortSignal.timeout(5000) });
        if (dealsRes.ok) {
            const j = await dealsRes.json();
            if (Array.isArray(j.results) && j.results.length > 0) {
                initialData.deals = j.results;
            }
        }
    } catch (e) {
        console.log('Deals live fetch skipped/timeout:', e.message);
    }

    // Fetch live stats
    try {
        const statsRes = await fetch(`${API_BASE}/api/site/stats`, { signal: AbortSignal.timeout(5000) });
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
        initialData.stats = {
            carsMonitored: 12850,
            avgSavings: 2450,
            listingsToday: 380,
            refreshRate: '5 min'
        };
    }

    // Fallback seed deals if live deals fetch timed out or failed
    if (!initialData.deals || initialData.deals.length === 0) {
        initialData.deals = [
            {
                id: "seed-deal-1",
                source: "Autovit",
                title: "Renault Clio V 1.0 TCe Equilibre - Garanție 12 Luni",
                price: "8990 €",
                currency: "EUR",
                year: 2021,
                mileage: 68000,
                fuel_type: "Benzină",
                deal_score: 9.6,
                link: "https://www.autovit.ro",
                image: "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=600&auto=format&fit=crop&q=60"
            },
            {
                id: "seed-deal-2",
                source: "OLX",
                title: "Volkswagen Golf VII 2.0 TDI Comfortline - Istoric Complet",
                price: "11450 €",
                currency: "EUR",
                year: 2018,
                mileage: 142000,
                fuel_type: "Diesel",
                deal_score: 9.4,
                link: "https://www.olx.ro",
                image: "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=600&auto=format&fit=crop&q=60"
            },
            {
                id: "seed-deal-3",
                source: "Autovit",
                title: "BMW Seria 3 320d xDrive M-Sport Automat",
                price: "16800 €",
                currency: "EUR",
                year: 2019,
                mileage: 128000,
                fuel_type: "Diesel",
                deal_score: 9.2,
                link: "https://www.autovit.ro",
                image: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=600&auto=format&fit=crop&q=60"
            },
            {
                id: "seed-deal-4",
                source: "Autovit",
                title: "Skoda Octavia Style 1.5 TSI DSG - Unic Proprietar",
                price: "13900 €",
                currency: "EUR",
                year: 2020,
                mileage: 89000,
                fuel_type: "Benzină",
                deal_score: 9.1,
                link: "https://www.autovit.ro",
                image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&auto=format&fit=crop&q=60"
            }
        ];
    }

    const targetPath = path.join(__dirname, '..', 'public', 'initial-data.json');
    fs.writeFileSync(targetPath, JSON.stringify(initialData));
    console.log(`Preloaded: ${initialData.brands.length} brands, ${initialData.deals.length} deals, stats ready.`);
}

fetchData();
