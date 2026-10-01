<p align="center">
  <img src="https://img.shields.io/badge/Motorbit-v2.0-0ea5e9?style=for-the-badge&labelColor=0a0a0a" alt="version"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="react"/>
  <img src="https://img.shields.io/badge/FastAPI-0.116-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="fastapi"/>
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="vite"/>
  <img src="https://img.shields.io/badge/Vercel-Deployed-000?style=for-the-badge&logo=vercel&logoColor=white" alt="vercel"/>
</p>

<h1 align="center">Motorbit</h1>

<p align="center">
  <strong>Used car listing aggregator for Romania</strong><br/>
  Searches OLX and Autovit at the same time · Advanced filters · Price alerts · Market analysis
</p>

---

## What it is

Motorbit aggregates used car listings from OLX.ro and Autovit.ro into a single search. It normalizes listings from both platforms into one schema, scores each listing against comparable cars, tracks price history, and sends email alerts when a matching car appears.

The application is live and the API is deployed as a serverless function on Vercel.

---

## Features

| Feature | Details |
|---|---|
| **Unified search** | Queries OLX and Autovit concurrently and merges the results |
| **Slug intelligence** | Maps model names to each platform's URL slugs, with more than 600 model mappings |
| **Deal scoring** | Scores each listing from 0 to 100 against its peers, accounting for generation and performance tier |
| **Market statistics** | Average, minimum and maximum price computed from live listings |
| **Price alerts** | Email notifications through Resend when a matching listing appears |
| **Bilingual** | Full Romanian and English interface |
| **Accounts** | Registration and login with bcrypt password hashing |
| **Dealer platform** | Dealer profiles, listings, review and view analytics |
| **Subscriptions** | Stripe Checkout and customer portal for dealer plans |
| **Background crawler** | Scheduled crawler that keeps listings fresh and retires expired ones |
| **Responsive design** | Modern UI with light and dark themes |

---

## Architecture

```
                    +----------------------------------+
                    |            FRONTEND              |
                    |      React 19 + Vite 7 SPA       |
                    |                                  |
                    |  SearchForm · CarCard · Results  |
                    |  SearchContext · AuthContext      |
                    |  LanguageContext (RO / EN)       |
                    +----------------+-----------------+
                                     |  REST over HTTPS
                                     v
                    +----------------------------------+
                    |       BACKEND, FastAPI           |
                    |                                  |
                    |  core_app.py     API endpoints   |
                    |  functii.py      search engine   |
                    |  car_database.py PostgreSQL      |
                    |  mailer.py       Resend email    |
                    +----------------+-----------------+
                                     |
              +----------------------+----------------------+
              |                      |                      |
              v                      v                      v
    +------------------+   +------------------+   +------------------+
    |   PostgreSQL     |   |   Redis cache    |   |    Scrapers      |
    |   via Supabase   |   |  search results  |   |  OLX  · Autovit  |
    +------------------+   +------------------+   +------------------+
                                                          ^
                                                          |
                                            +-----------------------------+
                                            |  GitHub Actions cron job    |
                                            |  scheduled crawl and alerts |
                                            +-----------------------------+
```

The client is a single page application served from Vercel's CDN. The API is a serverless Python function. The crawler runs on a schedule in GitHub Actions rather than in the request path, because a long scrape would exceed a serverless function's execution limit.

---

## Project structure

```
motorbit/
├── backend/
│   ├── core_app.py            # FastAPI application: endpoints, auth, rate limits
│   ├── car_database.py        # PostgreSQL access layer, schema, raw SQL queries
│   ├── functii.py             # Search orchestration, slug mappings, filtering
│   ├── models.py              # Reserved for request models
│   ├── mailer.py              # Transactional email through Resend
│   ├── crawler.py             # Scheduled crawl entry point
│   ├── deep_scrape.py         # Brand level scrape
│   ├── migrate_mb5.py         # Schema migration script
│   ├── prune_database.py      # Retention cleanup
│   ├── link_verifier.py       # Dead listing detection
│   ├── logger.py              # Structured logging
│   ├── metrics.py             # Counters and timings
│   ├── dead_letter.py         # Failed scrape capture, JSON lines
│   ├── scraper/
│   │   ├── olx_scraper.py     # OLX scraper, aiohttp and BeautifulSoup
│   │   └── autovit_scraper.py # Autovit scraper, with user agent rotation
│   └── tests/
│       └── test_bug_fixes.py  # Unit tests for specific regressions
└── frontend/car-sniper/
    ├── src/
    │   ├── App.jsx            # Routes and application shell
    │   ├── contexts/          # SearchContext, AuthContext
    │   ├── LanguageContext.jsx# Romanian and English strings
    │   ├── components/        # SearchForm, CarCard, DealOfTheDay, and others
    │   └── utils/             # Cache, analytics, comparison helpers
    ├── scripts/prebuild.cjs   # Bakes initial data into the bundle at build time
    └── public/                # Static assets, sitemap, robots
```

---

## How deal scoring works

Each listing is scored from 0 to 100 against a peer group rather than against the whole market.

**Peer selection.** Cars are grouped by make, model, generation and performance tier, within two years of the listing's year. Generation detection uses a mapping file, and performance tier detection looks for markers such as AMG, M Sport, S line, GTI or Quadrifoglio. If a listing has fewer than three peers, the pool widens to the same performance tier within two years. If there are still no peers, it falls back to the global average for the model, and if the year is too far from that average the listing is left unscored rather than given a misleading number.

**The score.**

```
price_factor = (peer_average_price - price) / peer_average_price
km_factor    = (peer_average_km - km) / peer_average_km
score        = clamp(50 + price_factor * 100 + km_factor * 20, 0, 100)
```

A listing at the peer average scores 50. Cheaper than average scores higher, fewer kilometers scores higher.

**Limitations.** A listing with no mileage recorded currently scores as if it had zero kilometers, which is wrong and should be excluded instead. The top deals endpoint uses a second implementation in SQL that weights price and mileage differently from this one, so the two can disagree. Consolidating them is on the list.

---

## Installation

### Requirements

- Python 3.10 or later
- Node.js 18 or later
- A PostgreSQL database, Supabase works on the free tier
- Optional: a Redis instance for caching, and a Resend API key for email

### Backend

```sh
cd backend
python3 -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
```

### Frontend

```sh
cd frontend/car-sniper
npm ci
```

### Environment variables

Create `backend/.env`:

```sh
# Required
DATABASE_URL=postgresql://user:password@host:5432/motorbit

# Strongly recommended. Without it a random secret is generated per process,
# which invalidates every session on restart.
JWT_SECRET=

# Optional. Search caching.
REDIS_URL=

# Optional. Price alert emails.
RESEND_API_KEY=

# Optional. Dealer subscriptions.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PREMIUM=
STRIPE_PRICE_ENTERPRISE=

# Optional. Protects the scheduled endpoints.
CRON_SECRET=
```

### Run

```sh
# Backend, from the backend directory
uvicorn main:app --reload

# Frontend, from frontend/car-sniper
npm run dev
```

The API serves on `http://127.0.0.1:8000` and the client on `http://localhost:5173`.

---

## API

### Search

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search` | Unified search across OLX and Autovit |
| `GET` | `/api/brands` | All available makes |
| `GET` | `/api/models/{brand}` | Models for a make |
| `GET` | `/api/generations/{make}/{model}` | Generations for a model |
| `GET` | `/api/deals/top` | Top scored listings |

### Statistics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats/{make}/{model}` | Average, minimum and maximum price |
| `GET` | `/api/model-info/{make}/{model}` | Model detail |
| `GET` | `/api/model-year-range/{make}/{model}` | Production year range |

### Accounts, alerts and dealers

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/alert` | Create a price alert |
| `GET` | `/api/dealer/listings` | Dealer listing management |
| `POST` | `/api/contact` | Partner enquiry form |

### Example

```bash
curl "http://localhost:8000/api/search?make=BMW&model=Seria%203&max_price=15000&site=both&limit=50"
```

```json
{
  "results": [
    {
      "title": "BMW 320d M Sport 2019",
      "price": 14500,
      "year": 2019,
      "km": 85000,
      "link": "https://www.autovit.ro/anunt/...",
      "image": "https://...",
      "source": "autovit",
      "deal_score": 72,
      "peer_avg_price": 16800,
      "price_diff": 2300
    }
  ],
  "total": 1,
  "limit": 50
}
```

---

## Notable implementation details

**Slug intelligence.** Model names are translated into each platform's own URL format. A single user query becomes the correct path for both sites.

```
BMW 320d       ->  seria-3    (OLX and Autovit)
Mercedes C220  ->  clasa-c    (OLX uses mercedes-benz/clasa-c)
Audi A4        ->  a4
```

**Concurrent scraping.** Both platforms are scraped in the same asyncio gather, with `return_exceptions` set so one platform failing does not lose the other's results. Detail page enrichment runs behind a semaphore to stay within polite request rates.

**Cross platform deduplication.** Listings are deduplicated by a hash of the normalized URL, so the same car appearing on both platforms is stored once.

**Failure capture.** Listings that fail to parse are written to a date rotated JSON lines file under `dead_letter/` rather than being dropped, so the failure can be inspected and replayed.

**Build time data.** A prebuild script fetches the most common data at build time and writes it to a static JSON file, so the first paint has content before the API responds.

---

## Deployment

The backend deploys to Vercel as a Python serverless function and the frontend as a static build. Both are configured in the root `vercel.json`, which also sets CDN cache headers per route.

Live scraping from within a request is disabled on serverless because it would exceed the execution limit. The scheduled crawler in GitHub Actions is what keeps the data fresh.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, React Router 7 |
| Styling | Plain CSS with custom properties, light and dark themes |
| Backend | Python 3.10+, FastAPI, Uvicorn, Pydantic |
| Database | PostgreSQL via Supabase, accessed with psycopg2 using raw SQL |
| Caching | Redis, with a fifteen minute TTL on search results |
| Scraping | aiohttp and BeautifulSoup |
| Email | Resend |
| Payments | Stripe Checkout and customer portal |
| Auth | JWT with bcrypt password hashing |
| Rate limiting | slowapi |
| Hosting | Vercel, with a GitHub Actions crawler |
| CI | GitHub Actions: syntax, lint, formatting, type check and tests |

---

## License

MIT. See [LICENSE](LICENSE).
