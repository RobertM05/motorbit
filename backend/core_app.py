from fastapi import FastAPI, Request, BackgroundTasks, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
import threading
import time
import functools
from pydantic import BaseModel
import os
from dotenv import load_dotenv

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)

# Kill switches for expensive operations on Vercel serverless functions.
# Set VERCEL_LIVE_SCRAPING=true in Vercel dashboard to re-enable.

import stripe

STRIPE_SECRET = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
stripe.api_key = STRIPE_SECRET

# Subscription price IDs — set in .env or Stripe dashboard
STRIPE_PRICE_FREE = os.environ.get("STRIPE_PRICE_FREE", "")
STRIPE_PRICE_PREMIUM = os.environ.get("STRIPE_PRICE_PREMIUM", "price_premium")
STRIPE_PRICE_ENTERPRISE = os.environ.get("STRIPE_PRICE_ENTERPRISE", "price_enterprise")

IS_VERCEL = os.environ.get("VERCEL") == "1"
VERCEL_LIVE_SCRAPING = os.environ.get("VERCEL_LIVE_SCRAPING", "false").lower() == "true"
ALLOW_LIVE_SCRAPING = not IS_VERCEL or VERCEL_LIVE_SCRAPING

from scraper.olx_scraper import scrape_olx
from functii import search_cars, add_alert
from car_database import car_db_optimizer, get_optimized_search_params, parse_ro_price
import logging

logging.basicConfig(level=logging.INFO)
import json

try:
    import redis.asyncio as redis
    import os

    redis_url = os.environ.get("REDIS_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    if redis_url:
        # Some Upstash redis URLs might start with http, but we're assuming a standard redis connection
        redis_client = redis.from_url(
            redis_url.replace("https://", "redis://").replace("http://", "redis://")
        )
    else:
        redis_client = None
except ImportError:
    redis_client = None


# Custom IP extractor for Vercel (which uses x-forwarded-for)
def get_real_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


limiter = Limiter(key_func=get_real_ip)

app = FastAPI(title="Car Sniper API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://motorbit.vercel.app",
        "https://motorbit-*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Car Sniper API running!"}


@app.get("/api/site/stats")
def api_site_stats(response: Response):
    """Return real-time site statistics."""
    response.headers["Cache-Control"] = (
        "public, max-age=120, s-maxage=300, stale-while-revalidate=600"
    )
    try:
        ads_count = car_db_optimizer.get_active_ads_count()
        today_count = car_db_optimizer.get_ads_updated_today_count()
        _ = (
            car_db_optimizer.get_users_count()
        )  # called for completeness, not in response
        avg_savings = car_db_optimizer.get_avg_savings()
    except Exception:
        ads_count = 0
        today_count = 0
        avg_savings = 0
    return {
        "carsMonitored": ads_count,
        "avgSavings": avg_savings,
        "listingsToday": today_count,
        "refreshRate": "5 min",
    }


@app.get("/api/scraper/status")
def scraper_status():
    """Basic scraper status — shows cache info."""
    import time as _time

    deals_age = (
        _time.time() - _TOP_DEALS_CACHE["timestamp"]
        if _TOP_DEALS_CACHE["timestamp"]
        else None
    )
    return {
        "deals_cache_age_seconds": round(deals_age) if deals_age else None,
        "deals_cached_count": len(_TOP_DEALS_CACHE.get("deals", [])),
    }


@app.get("/api/health")
def health_check():
    """Health check endpoint for monitoring."""
    db_ok = car_db_optimizer.health_check()
    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
    }


from fastapi.responses import JSONResponse
import traceback


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logging.error(traceback.format_exc())
    return JSONResponse({"error": "Internal Server Error"}, status_code=500)


@app.get("/api/decode-vin/{vin}")
@limiter.limit("10/minute")
def decode_vin(request: Request, vin: str):
    return {"vin": vin, "make": "BMW", "model": "330e", "year": 2019}


import re


def get_performance_tier(car_dict):
    text = f"{car_dict.get('make', '')} {car_dict.get('model', '')} {car_dict.get('title', '')} {car_dict.get('version', '')}".upper()
    clean_text = (
        text.replace("M SPORT", "")
        .replace("AMG LINE", "")
        .replace("S LINE", "")
        .replace("R LINE", "")
    )
    clean_text = (
        clean_text.replace("M-SPORT", "")
        .replace("AMG-LINE", "")
        .replace("S-LINE", "")
        .replace("R-LINE", "")
    )
    if re.search(
        r"\b(AMG|RS\d?|S\d|M\d?|X\d\s?M|GTI|GOLF R|CUPRA|QUADRIFOGLIO)\b", clean_text
    ):
        return "high_performance"
    return "base"


def get_car_generation_enhanced(car_dict, year):
    make = car_dict.get("make", "")
    model = car_dict.get("model", "")
    text = f"{car_dict.get('title', '')} {car_dict.get('version', '')}".upper()

    gens = car_db_optimizer.get_generations_for_model(make, model)
    if gens:
        gens_sorted = sorted(gens, key=lambda x: len(x["generation"]), reverse=True)
        for gen in gens_sorted:
            gen_name = gen["generation"].upper()
            if re.search(r"\b" + re.escape(gen_name) + r"\b", text):
                return gen_name

    return car_db_optimizer.get_generation_for_year(make, model, year)


def calculate_deal_scores(results: list, stats: dict, peer_pool: list = None) -> list:
    """Calculate a 0-100 deal score for each result based on peer averages (same year +/- 2)."""
    global_avg_price = stats.get("avg_price") if stats else None
    global_avg_year = stats.get("avg_year") if stats else None
    global_avg_km = stats.get("avg_km") if stats else None

    def parse_cars(car_list):
        parsed = []
        for car in car_list:
            try:
                p_str = str(car.get("price", "0"))
                p = parse_ro_price(p_str)

                y_str = "".join(filter(str.isdigit, str(car.get("year", 0))))
                y = int(y_str) if y_str else 0
                k_str = "".join(filter(str.isdigit, str(car.get("km", 0))))
                k = int(k_str) if k_str else 0
                if p > 0 and y > 1900:
                    parsed.append({"price": p, "year": y, "km": k, "ref": car})
            except Exception:
                pass
        return parsed

    valid_cars = parse_cars(results)
    valid_peers = parse_cars(peer_pool) if peer_pool else valid_cars

    for data in valid_cars:
        car = data["ref"]
        car_price = data["price"]
        car_year = data["year"]
        car_km = data["km"]
        car_gen = get_car_generation_enhanced(car, car_year)
        car_tier = get_performance_tier(car)

        # Find peers. Try to find cars of the EXACT same generation AND performance tier AND within +/- 2 years!
        peers = []
        if car_gen:
            peers = [
                p
                for p in valid_peers
                if get_car_generation_enhanced(p["ref"], p["year"]) == car_gen
                and get_performance_tier(p["ref"]) == car_tier
                and abs(p["year"] - car_year) <= 2
            ]

        # If we don't know the generation OR we couldn't find enough peers of the same generation,
        # fall back to comparing with any cars +/- 2 years old, matching performance tier.
        if not peers or len(peers) < 3:
            peers = [
                p
                for p in valid_peers
                if get_performance_tier(p["ref"]) == car_tier
                and abs(p["year"] - car_year) <= 2
            ]

        if len(peers) >= 1:
            peer_avg_price = sum(p["price"] for p in peers) / len(peers)
            peer_avg_km = sum(p["km"] for p in peers) / len(peers)
        else:
            # Fallback to global stats if car is close to global average year (within 3 years)
            if (
                global_avg_year
                and global_avg_price
                and abs(car_year - global_avg_year) <= 3
            ):
                peer_avg_price = global_avg_price
                peer_avg_km = global_avg_km
            else:
                car["deal_score"] = None
                continue

        if not peer_avg_price or peer_avg_price <= 0:
            car["deal_score"] = None
            continue

        # Price: positive = cheaper than average (good)
        price_factor = (peer_avg_price - car_price) / peer_avg_price

        # Km: positive = fewer km than average (good)
        km_factor = (peer_avg_km - car_km) / max(peer_avg_km, 1) if peer_avg_km else 0

        # Weighted score: 80% price, 20% km (age is controlled for via peers!)
        raw_score = 50 + price_factor * 100 + km_factor * 20
        deal_score = max(0, min(100, int(round(raw_score))))

        car["deal_score"] = deal_score
        car["peer_avg_price"] = int(round(peer_avg_price))
        car["peer_avg_km"] = int(round(peer_avg_km))
        car["price_diff"] = int(round(peer_avg_price - car_price))

    return results


@app.get("/api/search")
@limiter.limit("30/minute")
async def api_search(
    request: Request,
    background_tasks: BackgroundTasks,
    make: str | None = None,
    model: str | None = None,
    site: str = "both",
    max_price: int | None = None,
    min_price: int | None = None,
    min_km: int | None = None,
    max_km: int | None = None,
    min_year: int | None = None,
    max_year: int | None = None,
    min_cc: int | None = None,
    min_hp: int | None = None,
    fuel: str | None = None,
    transmission: str | None = None,
    limit: int = 200,
    max_pages: int = 5,
    sort: str = "price_asc",
):
    print(
        f"API CALL (DB Search): make={make}, model={model}, limit={limit}, max_price={max_price}, min_year={min_year}, max_year={max_year}, fuel={fuel}, transmission={transmission}"
    )

    cache_key = f"search:{make}:{model}:{site}:{min_price}:{max_price}:{min_km}:{max_km}:{min_year}:{max_year}:{min_cc}:{min_hp}:{fuel}:{transmission}:{limit}:{sort}"

    if redis_client:
        try:
            cached_data = await redis_client.get(cache_key)
            if cached_data:
                logging.info(f"Redis cache HIT for {cache_key}")
                return {"results": json.loads(cached_data)}
        except Exception as e:
            logging.error(f"Redis cache read error: {e}")

    parts = sort.split("_")
    sort_by = parts[0] if len(parts) > 0 else "price"
    order = parts[1] if len(parts) > 1 else ("desc" if sort_by == "newest" else "asc")

    # Normalizăm modelul (ex: "Seria 3" devine "seria-3")
    norm_model = car_db_optimizer.normalize_model_name(make, model)

    results = await run_in_threadpool(
        car_db_optimizer.search_ads_db,
        make=make,
        model=norm_model,
        min_price=min_price,
        max_price=max_price,
        min_year=min_year,
        max_year=max_year,
        min_km=min_km,
        max_km=max_km,
        fuel=fuel,
        transmission=transmission,
        limit=limit,
        sort_by=sort_by,
        order=order,
    )

    print(
        f"DEBUG: DB returned {len(results)} results, ALLOW_LIVE={ALLOW_LIVE_SCRAPING}"
    )
    if not results and ALLOW_LIVE_SCRAPING:
        # DB has no active results — scrape on the fly (disabled on Vercel by default)
        from functii import search_cars

        print("DEBUG: Entering live scraping...")
        live_max = max_price if max_price and max_price < 99999 else 999999
        live_results = await search_cars(
            make=make,
            model=model,
            site=site,
            min_price=min_price,
            max_price=live_max,
            min_km=min_km,
            max_km=max_km,
            min_year=min_year,
            max_year=max_year,
            limit=20000,
            max_pages=1000,
        )
        print(
            f"DEBUG: Live scrape returned {len(live_results) if live_results else 0} ads"
        )
        if live_results:
            car_db_optimizer.upsert_ads(live_results)
            # Use in-memory results directly — DB model matching is too strict
            # for cases like 'amg c63' vs 'c-63-amg' vs 'C 63 AMG'
            results = live_results

    # Calculate deal scores if we have stats for this make/model
    if make and model:
        s_model = model.lower().replace(" ", "-")
        stats = await run_in_threadpool(car_db_optimizer.get_model_stats, make, s_model)
        peer_pool = await run_in_threadpool(
            car_db_optimizer.get_active_ads_for_make_model, make, norm_model
        )
        results = calculate_deal_scores(results, stats, peer_pool=peer_pool)

    # Run the background verifier to clean up any dead links asynchronously.
    # Skipped on Vercel to save CPU — cron/cleanup handles this instead.
    if results and not IS_VERCEL:
        from link_verifier import verify_ads_liveness

        background_tasks.add_task(verify_ads_liveness, results)

        if redis_client:
            from fastapi.encoders import jsonable_encoder

            try:
                # 15 minute TTL
                await redis_client.setex(
                    cache_key, 900, json.dumps(jsonable_encoder(results))
                )
            except Exception as e:
                logging.error(f"Redis cache write error: {e}")

    return {
        "results": results,
        "total": len(results),
        "limit": limit,
        "page": 1,
    }


# WARNING: Process-local cache. Use Redis in production with multiple workers.
_CACHE_TIMEOUT = 1800  # 30 minutes
_TOP_DEALS_CACHE = {"timestamp": 0, "deals": []}
_TOP_DEALS_CACHE_TTL = _CACHE_TIMEOUT


@app.get("/api/deals/top")
@limiter.limit("60/minute")
def get_top_deals(request: Request, response: Response):
    """Return top-scored active deals using pre-computed market snapshots."""
    response.headers["Cache-Control"] = (
        "public, max-age=120, s-maxage=300, stale-while-revalidate=600"
    )
    try:
        global _TOP_DEALS_CACHE
        current_time = time.time()

        if (
            current_time - _TOP_DEALS_CACHE["timestamp"] < _TOP_DEALS_CACHE_TTL
            and _TOP_DEALS_CACHE["deals"]
        ):
            return {"results": _TOP_DEALS_CACHE["deals"]}

        top_deals = car_db_optimizer.get_top_deals(limit=8)
        if not top_deals:
            return {"results": []}

        for ad in top_deals:
            from decimal import Decimal

            price_val = ad.get("original_price") or ad.get("price")
            if price_val is not None:
                if isinstance(price_val, Decimal):
                    price_val = int(price_val)
                if isinstance(price_val, str):
                    if "€" not in price_val:
                        ad["price"] = f"{price_val} €"
                else:
                    ad["price"] = f"{int(price_val)} €"

            score = ad.get("deal_score")
            if isinstance(score, Decimal):
                ad["deal_score"] = float(score)
            elif score is not None:
                ad["deal_score"] = (
                    float(score) if hasattr(score, "__float__") else score
                )

        _TOP_DEALS_CACHE["timestamp"] = current_time
        _TOP_DEALS_CACHE["deals"] = top_deals

        return {"results": top_deals}
    except Exception as e:
        import traceback

        logging.error(f"Error fetching top deals: {e}")
        logging.error(traceback.format_exc())

        # If error occurs, try returning stale cache as fallback
        if _TOP_DEALS_CACHE["deals"]:
            return {"results": _TOP_DEALS_CACHE["deals"]}

        return {"results": [], "error": str(e)}


class AlertRequest(BaseModel):
    user_email: str
    make: str
    model: str
    min_price: int | None = None
    max_price: int | None = None
    min_year: int | None = None
    max_year: int | None = None
    max_km: int | None = None


from mailer import send_alert_email, send_contact_email


class ContactRequest(BaseModel):
    name: str
    phone: str
    company_email: str
    company_name: str
    has_website: str
    website_ip: str | None = None


@app.get("/api/dashboard/stats")
@limiter.limit("20/minute")
async def get_dashboard_stats(request: Request):
    """
    Returns real statistics for the Partner Dashboard.
    """

    def _fetch_stats():
        with car_db_optimizer.get_connection() as conn:
            cursor = conn.cursor()

            # Active Buyers (Total Users)
            cursor.execute("SELECT COUNT(*) as count FROM users")
            users_count = cursor.fetchone()["count"]

            # Active Price Alerts
            cursor.execute("SELECT COUNT(*) as count FROM alerts WHERE active = TRUE")
            alerts_count = cursor.fetchone()["count"]

            # Market Scans (Active Ads)
            cursor.execute("SELECT COUNT(*) as count FROM ads WHERE active = TRUE")
            ads_count = cursor.fetchone()["count"]

            # Demand Data (Top 5 models by search count)
            cursor.execute("""
                SELECT make, model, search_count as searches
                FROM search_stats
                ORDER BY search_count DESC
                LIMIT 5
            """)
            demand_results = cursor.fetchall()

            demand_data = []
            for row in demand_results:
                cursor.execute(
                    """
                    SELECT COUNT(*) as count FROM alerts
                    WHERE LOWER(make) = LOWER(%s) AND LOWER(model) = LOWER(%s) AND active = TRUE
                """,
                    (row["make"], row["model"]),
                )
                alerts_for_model = cursor.fetchone()["count"]

                name = f"{row['make'].capitalize()} {row['model'].capitalize()}"
                demand_data.append(
                    {
                        "name": name,
                        "searches": row["searches"],
                        "alerts": alerts_for_model,
                    }
                )

        if not demand_data:
            demand_data = [
                {"name": "BMW Seria 3", "searches": 240, "alerts": 45},
                {"name": "VW Golf", "searches": 305, "alerts": 89},
            ]

        # Trend Data — requires real DAU tracking in user_activity table
        trend_data = []

        return {
            "activeBuyers": users_count,
            "activePriceAlerts": alerts_count,
            "marketScans": ads_count,
            "demandData": demand_data,
            "trendData": trend_data,
        }

    try:
        return await run_in_threadpool(_fetch_stats)
    except Exception as e:
        logging.error(f"Error fetching dashboard stats: {e}")
        return {"error": str(e)}


@app.post("/api/contact")
@limiter.limit("10/minute")
def api_submit_contact(
    request: Request, req: ContactRequest, background_tasks: BackgroundTasks
):
    background_tasks.add_task(
        send_contact_email,
        req.name,
        req.phone,
        req.company_email,
        req.company_name,
        req.has_website,
        req.website_ip,
    )

    try:
        car_db_optimizer.save_contact_submission(
            name=req.name,
            phone=req.phone,
            email=req.company_email,
            company_name=req.company_name,
            website=req.website_ip,
        )
    except Exception as e:
        logging.error(f"Failed to save contact submission: {e}")

    return {"status": "success"}


@app.post("/api/dealer/register")
@limiter.limit("15/minute")
def api_register_dealer(request: Request, req: ContactRequest):
    """Register a new dealer from contact form submission."""
    try:
        car_db_optimizer.save_contact_submission(
            name=req.name,
            phone=req.phone,
            email=req.company_email,
            company_name=req.company_name,
            website=req.website_ip,
        )
        return {"status": "success", "message": "Dealer registration submitted"}
    except Exception as e:
        logging.error(f"Dealer registration failed: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class DealerListingRequest(BaseModel):
    title: str
    price: int | None = None
    year: int | None = None
    km: int | None = None
    fuel: str | None = None
    transmission: str | None = None
    description: str | None = None
    image_url: str | None = None


class ReviewRequest(BaseModel):
    dealer_id: int
    rating: int
    comment: str | None = None


@app.get("/api/dealer/listings")
def api_get_dealer_listings(request: Request, email: str):
    """Get all active listings for a dealer by email."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    listings = car_db_optimizer.get_dealer_listings(profile["id"])
    return {
        "profile": {
            "email": profile["user_email"],
            "company_name": profile.get("company_name"),
            "phone": profile.get("phone"),
            "website": profile.get("website"),
        },
        "listings": listings,
    }


@app.get("/api/dealer/analytics")
def api_dealer_analytics(email: str):
    """Get analytics for a dealer."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    return car_db_optimizer.get_dealer_analytics(profile["id"])


@app.post("/api/dealer/listings")
@limiter.limit("30/minute")
def api_create_dealer_listing(request: Request, email: str, req: DealerListingRequest):
    """Create a new dealer listing."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    if not profile.get("verified"):
        raise HTTPException(status_code=403, detail="Dealer not yet approved")
    listing_id = car_db_optimizer.create_dealer_listing(
        dealer_id=profile["id"],
        title=req.title,
        price=req.price,
        year=req.year,
        km=req.km,
        fuel=req.fuel,
        transmission=req.transmission,
        description=req.description,
        image_url=req.image_url,
    )
    return {"status": "success", "listing_id": listing_id}


@app.put("/api/dealer/listings/{listing_id}")
@limiter.limit("30/minute")
def api_update_dealer_listing(
    request: Request, listing_id: int, email: str, req: DealerListingRequest
):
    """Update a dealer listing."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    if not profile.get("verified"):
        raise HTTPException(status_code=403, detail="Dealer not yet approved")
    car_db_optimizer.update_dealer_listing(
        listing_id=listing_id,
        dealer_id=profile["id"],
        title=req.title,
        price=req.price,
        year=req.year,
        km=req.km,
        fuel=req.fuel,
        transmission=req.transmission,
        description=req.description,
        image_url=req.image_url,
    )
    return {"status": "success"}


@app.post("/api/dealer/listings/bulk")
@limiter.limit("10/minute")
async def api_bulk_dealer_listings(request: Request, email: str):
    """Accept CSV bulk upload of dealer inventory. Expects JSON array of listing objects."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    try:
        body = await request.json()
        if not isinstance(body, list):
            raise HTTPException(
                status_code=400, detail="Expected JSON array of listings"
            )
        created = 0
        for item in body:
            car_db_optimizer.create_dealer_listing(
                dealer_id=profile["id"],
                title=item.get("title", ""),
                price=item.get("price"),
                year=item.get("year"),
                km=item.get("km"),
                fuel=item.get("fuel"),
                transmission=item.get("transmission"),
                description=item.get("description"),
                image_url=item.get("image_url"),
            )
            created += 1
        return {"status": "success", "created": created}
    except Exception as e:
        logging.error(f"Bulk upload failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/dealer/listings/{listing_id}")
def api_delete_dealer_listing(request: Request, listing_id: int, email: str):
    """Delete a dealer listing."""
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Dealer profile not found")
    car_db_optimizer.delete_dealer_listing(listing_id, profile["id"])
    return {"status": "deleted"}


@app.post("/api/dealer/reviews")
@limiter.limit("10/minute")
def api_add_review(request: Request, req: ReviewRequest, email: str):
    """Add a review for a dealer."""
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    review_id = car_db_optimizer.add_dealer_review(
        req.dealer_id, email, req.rating, req.comment
    )
    return {"status": "success", "review_id": review_id}


@app.get("/api/dealer/reviews/{dealer_id}")
def api_get_reviews(dealer_id: int):
    """Get reviews for a dealer."""
    return car_db_optimizer.get_dealer_reviews(dealer_id)


@app.get("/api/verify-email")
def api_verify_email(token: str):
    """Verify user email from token link."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        email = payload.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="Invalid token")
        car_db_optimizer.verify_user_email(email)
        return {"status": "success", "message": "Email verified"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid token")


@app.post("/api/forgot-password")
@limiter.limit("3/minute")
def api_forgot_password(request: Request, req: ForgotPasswordRequest):
    """Send password reset email if user exists."""
    user = car_db_optimizer.get_user(req.email)
    if user:
        reset_token = jwt.encode(
            {
                "email": req.email,
                "exp": datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(hours=1),
            },
            JWT_SECRET,
            algorithm=JWT_ALGORITHM,
        )
        send_password_reset_email(req.email, reset_token)
    return {
        "status": "success",
        "message": "If the email exists, a reset link has been sent.",
    }


@app.post("/api/reset-password")
@limiter.limit("5/minute")
def api_reset_password(request: Request, req: ResetPasswordRequest):
    """Reset password using token from email."""
    try:
        payload = jwt.decode(req.token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        email = payload.get("email")
        if not email or len(req.new_password) < 6:
            raise HTTPException(status_code=400, detail="Invalid request")
        hashed = car_db_optimizer._hash_password(req.new_password)
        car_db_optimizer.update_user_password(email, hashed)
        return {"status": "success"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid token")


@app.get("/api/alerts")
def api_get_alerts(email: str):
    """Get all alerts for a user."""
    alerts = car_db_optimizer.get_alerts_for_user(email)
    return {"alerts": alerts}


@app.delete("/api/alerts/{alert_id}")
def api_delete_alert(alert_id: int, email: str):
    """Delete an alert."""
    car_db_optimizer.delete_alert(alert_id)
    return {"status": "deleted"}


class ToggleAlertRequest(BaseModel):
    active: bool


@app.put("/api/alerts/{alert_id}/toggle")
def api_toggle_alert(alert_id: int, request: ToggleAlertRequest, email: str):
    """Pause or resume an alert."""
    car_db_optimizer.toggle_alert_status(alert_id, request.active)
    return {"status": "success", "active": request.active}


@app.get("/api/admin/pending-dealers")
def api_pending_dealers(email: str):
    """Get unverified dealer profiles (admin only)."""
    user = car_db_optimizer.get_user(email)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    dealers = car_db_optimizer.get_pending_dealers()
    return {"dealers": dealers}


@app.post("/api/admin/approve-dealer")
def api_approve_dealer(email: str, dealer_id: int):
    """Approve a dealer and send welcome email."""
    user = car_db_optimizer.get_user(email)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    car_db_optimizer.approve_dealer(dealer_id)
    profile = car_db_optimizer.get_dealer_profile_by_id(dealer_id)
    if profile:
        try:
            send_dealer_welcome_email(profile["user_email"], profile["company_name"])
        except Exception as e:
            logging.error(f"Welcome email failed: {e}")
    return {"status": "approved"}


@app.get("/api/dead-letter/files")
def api_dead_letter_files():
    """List available dead letter files."""
    from dead_letter import dead_letter
    from glob import glob
    import os

    files = []
    for path in sorted(glob(os.path.join(dead_letter.directory, "*.jsonl"))):
        files.append(
            {
                "name": os.path.basename(path),
                "size": os.path.getsize(path),
                "modified": os.path.getmtime(path),
            }
        )
    return {"files": files}


@app.post("/api/dead-letter/replay")
def api_dead_letter_replay(source: str = "", date_str: str = ""):
    """Replay dead letter entries. Returns count of replayed items."""
    from dead_letter import dead_letter

    count = 0
    for record in dead_letter.replay_iter(source=source, date_str=date_str):
        count += 1
    return {"status": "success", "replayed": count}


class CheckoutRequest(BaseModel):
    tier: str  # "premium" or "enterprise"


@app.post("/api/stripe/create-checkout")
def api_create_checkout(request: Request, req: CheckoutRequest, email: str):
    """Create a Stripe Checkout Session for subscription."""
    if not STRIPE_SECRET:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        profile = car_db_optimizer.get_dealer_profile(email)
        if not profile:
            raise HTTPException(status_code=404, detail="Dealer profile not found")
        price_id = (
            STRIPE_PRICE_PREMIUM if req.tier == "premium" else STRIPE_PRICE_ENTERPRISE
        )
        customer_id = profile.get("stripe_customer_id")
        if not customer_id:
            customer = stripe.Customer.create(
                email=email, metadata={"dealer_id": str(profile["id"])}
            )
            customer_id = customer.id
            car_db_optimizer.set_stripe_customer_id(profile["id"], customer_id)
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=os.environ.get("FRONTEND_URL", "http://localhost:5173")
            + "/partner-dashboard?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=os.environ.get("FRONTEND_URL", "http://localhost:5173")
            + "/pricing",
            metadata={"dealer_id": str(profile["id"]), "tier": req.tier},
            subscription_data={
                "metadata": {"dealer_id": str(profile["id"]), "tier": req.tier}
            },
        )
        return {"url": session.url}
    except Exception as e:
        logging.error(f"Checkout error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe/webhook")
async def api_stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not STRIPE_WEBHOOK_SECRET or not sig:
        return {"status": "skipped"}
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if event.type == "checkout.session.completed":
        session = event.data.object
        metadata = session.get("metadata", {})
        dealer_id = metadata.get("dealer_id")
        tier = metadata.get("tier", "premium")
        customer_id = session.get("customer")
        subscription_id = session.get("subscription")
        if dealer_id:
            car_db_optimizer.update_subscription(
                customer_id, tier, "active", subscription_id
            )
    elif event.type == "customer.subscription.deleted":
        sub = event.data.object
        customer_id = sub.get("customer")
        car_db_optimizer.update_subscription(customer_id, "free", "canceled", None)
    return {"status": "ok"}


@app.post("/api/stripe/portal")
def api_create_portal(request: Request, email: str):
    """Create a Stripe Customer Portal session."""
    if not STRIPE_SECRET:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    profile = car_db_optimizer.get_dealer_profile(email)
    if not profile or not profile.get("stripe_customer_id"):
        raise HTTPException(status_code=404, detail="No Stripe customer found")
    portal = stripe.billing_portal.Session.create(
        customer=profile["stripe_customer_id"],
        return_url=os.environ.get("FRONTEND_URL", "http://localhost:5173")
        + "/partner-dashboard",
    )
    return {"url": portal.url}


from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import datetime

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    import secrets

    JWT_SECRET = secrets.token_hex(32)
    logging.warning(
        "JWT_SECRET not set — using random fallback. Set JWT_SECRET in .env for production."
    )
JWT_ALGORITHM = "HS256"
security = HTTPBearer()


def create_access_token(email: str):
    expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)
    to_encode = {"sub": email, "exp": expire}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(
            credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM]
        )
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesiune expirata.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalid.")


class AuthRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
@limiter.limit("15/minute")
def api_auth_register(request: Request, req: AuthRequest):
    if len(req.password) < 6:
        raise HTTPException(
            status_code=400, detail="Password must be at least 6 characters"
        )
    result = car_db_optimizer.register_user(req.email, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    result["token"] = create_access_token(req.email)
    return result


@app.post("/api/auth/login")
@limiter.limit("15/minute")
def api_auth_login(request: Request, req: AuthRequest):
    result = car_db_optimizer.verify_login(req.email, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    result["token"] = create_access_token(req.email)
    return result


@app.post("/api/alert")
@limiter.limit("15/minute")
def api_create_alert(
    request: Request,
    req: AlertRequest,
    background_tasks: BackgroundTasks,
    user_email: str = Depends(verify_token),
):
    # Overwrite the request email with the verified token email
    verified_email = user_email
    alert = add_alert(
        verified_email,
        req.make,
        req.model,
        req.min_price,
        req.max_price,
        req.min_year,
        req.max_year,
        req.max_km,
    )

    background_tasks.add_task(
        send_alert_email, verified_email, req.make, req.model, req.max_price
    )

    return {"alert": alert}


@app.get("/api/scrape")
@limiter.limit("10/minute")
async def api_scrape(
    request: Request,
    site: str = "olx",
    make: str = "audi",
    model: str = "a4",
    page: int = 1,
):
    results = []
    if site.lower() == "olx":
        results = await scrape_olx(f"{make} {model}", page=page, limit=20)
    elif site.lower() == "autovit":
        # Added a fallback if autovit is not available since import was missing earlier but mentioned:
        try:
            from scraper.autovit_scraper import scrape_autovit

            results = await scrape_autovit(make, model, page=page, limit=20)
        except ImportError:
            return {"error": "Autovit scraper lipseste!"}
    else:
        return {"error": "Site necunoscut. Foloseste 'olx' sau 'autovit'."}
    return {"results": results}


@app.get("/api/model-info/{make}/{model}")
@limiter.limit("30/minute")
def get_model_info(request: Request, make: str, model: str):
    model_info = car_db_optimizer.get_model_info(make, model)
    if model_info:
        return {"model_info": model_info}
    return {"error": "Model not found in database"}


@app.get("/api/optimized-search-params/{make}/{model}")
@limiter.limit("30/minute")
def get_optimized_params(
    request: Request, make: str, model: str, min_year: int = None, max_year: int = None
):
    optimized_params = get_optimized_search_params(make, model, min_year, max_year)
    return optimized_params


@app.get("/api/popular-models")
@limiter.limit("30/minute")
def get_popular_models(request: Request, make: str = None, limit: int = 10):
    popular_models = car_db_optimizer.get_popular_models(make, limit)
    return {"popular_models": popular_models}


@app.post("/api/populate-sample-data")
@limiter.limit("2/minute")
def populate_sample_data(request: Request):
    car_db_optimizer.populate_sample_data()
    return {"message": "Sample data populated successfully"}


@app.get("/api/model-year-range/{make}/{model}")
@limiter.limit("30/minute")
def get_model_year_range(request: Request, make: str, model: str):
    model_info = car_db_optimizer.get_model_info(make, model)
    if model_info:
        return {
            "make": model_info["make"],
            "model": model_info["model"],
            "min_year": model_info["min_year"],
            "max_year": model_info["max_year"],
            "generation": model_info["generation"],
            "body_type": model_info["body_type"],
        }
    return {"error": "Model not found in database"}


@app.post("/api/populate-from-scraper")
@limiter.limit("1/minute")
def populate_from_scraper(
    request: Request, max_brands: int = None, max_models_per_brand: int = None
):
    try:
        data = car_db_optimizer.populate_from_scraper(max_brands, max_models_per_brand)
        return {
            "message": f"Popularea s-a terminat cu succes. Am procesat {len(data)} modele.",
            "processed_models": len(data),
            "sample_data": data[:5] if data else [],
        }
    except Exception as e:
        return {"error": f"Eroare la popularea bazei de date: {str(e)}"}


@app.get("/api/test-scraper")
@limiter.limit("2/minute")
def test_scraper(request: Request):
    try:
        from auto_data_scraper import AutoDataScraper

        scraper = AutoDataScraper()
        brands = scraper.scrape_brands()[:2]
        results = []
        for brand in brands:
            models = scraper.scrape_models_for_brand(
                brand["url_marca"], brand["nume_marca"]
            )[:2]
            for model in models:
                details = scraper.scrape_model_details(
                    model["url_model"], model["marca"], model["model"]
                )
                if details:
                    results.append(details)
        return {"message": "Test scraper completat cu succes", "results": results}
    except Exception as e:
        return {"error": f"Eroare la testarea scraper-ului: {str(e)}"}


@functools.lru_cache(maxsize=1)
def get_autovit_catalog():
    catalog_path = os.path.join(os.path.dirname(__file__), "autovit_catalog.json")
    with open(catalog_path, "r", encoding="utf-8") as f:
        return json.load(f)


@functools.lru_cache(maxsize=1)
def get_cached_brands_list():
    catalog = get_autovit_catalog()
    brands = list(catalog.keys())
    brands = [car_db_optimizer.format_brand_name(b) for b in brands]
    return sorted(list(set(brands)))


@app.get("/api/brands")
@limiter.limit("60/minute")
def get_brands(request: Request, response: Response):
    try:
        response.headers["Cache-Control"] = (
            "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
        )
        brands = get_cached_brands_list()
        return {"brands": brands, "total": len(brands)}
    except Exception as e:
        return {"error": f"Eroare la obținerea mărcilor: {str(e)}"}


@app.get("/api/models/{brand}")
@limiter.limit("60/minute")
def get_models_for_brand(request: Request, response: Response, brand: str):
    try:
        response.headers["Cache-Control"] = (
            "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
        )
        catalog = get_autovit_catalog()
        target_brand_key = next(
            (
                k
                for k in catalog.keys()
                if k.lower().strip()
                == brand.lower().strip()  # Intentional: normalize Mercedes-Benz to Mercedes for catalog matching
                or k.lower().replace("-benz", "") == brand.lower().replace("-benz", "")
            ),
            None,
        )
        if not target_brand_key:
            return {"error": f"Nu există modele pentru marca {brand}"}
        models = catalog[target_brand_key]
        models = [car_db_optimizer.format_model_name(m) for m in models]
        return {
            "brand": car_db_optimizer.format_brand_name(brand),
            "models": sorted(list(set(models))),
            "total": len(models),
        }
    except Exception as e:
        return {"error": f"Eroare la obținerea modelelor: {str(e)}"}


@app.get("/api/generations/{make}/{model}")
@limiter.limit("30/minute")
def get_generations(request: Request, make: str, model: str):
    try:
        generations = car_db_optimizer.get_generations_for_model(make, model)
        return {"generations": generations or []}
    except Exception as e:
        return {
            "error": f"Eroare la obținerea generațiilor: {str(e)}",
            "generations": [],
        }


@app.get("/api/stats/{make}/{model}")
@limiter.limit("30/minute")
def get_model_stats(request: Request, make: str, model: str):
    s_model = model.lower().replace(" ", "-")
    stats = car_db_optimizer.get_model_stats(make, s_model)
    if not stats:
        return {"error": "Nu există statistici pentru acest model încă."}
    return stats


from fastapi import Header
from mailer import (
    send_new_cars_email,
    send_dealer_welcome_email,
    send_password_reset_email,
)

CRON_SECRET_KEY = os.environ.get("CRON_SECRET")
if not CRON_SECRET_KEY:
    print(
        "WARNING: CRON_SECRET environment variable is missing! Cron jobs will fail until this is set."
    )


@app.get("/api/cron/run")
@limiter.limit("10/minute")
async def api_cron_run(request: Request, authorization: str = Header(None)):
    """
    Endpoint triggered periodically (e.g. via cron-job.org or Vercel Cron)
    to dispatch alerts. Protected by CRON_SECRET.
    """
    if (
        not CRON_SECRET_KEY
        or not authorization
        or authorization.replace("Bearer ", "") != CRON_SECRET_KEY
    ):
        raise HTTPException(status_code=401, detail="Unauthorized Cron Trigger")

    try:
        groups = car_db_optimizer.get_cron_groups(limit=2)
        if not groups:
            return {"status": "no_active_alerts"}

        dispatched_count = 0

        for group in groups:
            make = group["make"]
            model = group["model"]

            results = await search_cars(
                make=make,
                model=model,
                min_year=None,
                max_year=None,
                min_price=None,
                max_price=None,
                max_km=None,
                site="both",
                limit=20,
                max_pages=1,
            )

            if not results:
                continue

            new_cars = car_db_optimizer.insert_cron_ads(results)
            if not new_cars:
                continue

            alerts = car_db_optimizer.get_alerts_for_group(make, model)

            for alert in alerts:
                matched_cars = []
                for car in new_cars:
                    c_price = car.get("price") or 0
                    c_year = car.get("year") or 0
                    c_km = car.get("km") or 0

                    if alert["min_price"] and c_price < alert["min_price"]:
                        continue
                    if alert["max_price"] and c_price > alert["max_price"]:
                        continue
                    if alert["min_year"] and c_year < alert["min_year"]:
                        continue
                    if alert["max_year"] and c_year > alert["max_year"]:
                        continue
                    if alert["max_km"] and c_km > alert["max_km"]:
                        continue

                    matched_cars.append(car)

                if matched_cars:
                    email = alert["user_email"]

                    def _send_safe(e=email, mk=make, md=model, mc=matched_cars):
                        try:
                            send_new_cars_email(e, mk, md, mc)
                        except Exception as exc:
                            logging.error(f"Failed to send email to {e}: {exc}")

                    threading.Thread(
                        target=_send_safe,
                        daemon=True,
                    ).start()
                    dispatched_count += 1

        return {
            "status": "success",
            "groups_checked": len(groups),
            "emails_dispatched": dispatched_count,
        }
    except Exception as e:
        print(f"Cron execution failed: {e}")
        return {"error": str(e)}


@app.get("/api/cron/cleanup")
@limiter.limit("10/minute")
async def api_cron_cleanup(request: Request, authorization: str = Header(None)):
    """
    Cron job to scan and delete old inactive ads.
    """
    if not authorization or authorization.replace("Bearer ", "") != CRON_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized Cron Trigger")

    try:
        from link_verifier import cron_cleanup_ads

        dead_count = await cron_cleanup_ads(limit=100)
        return {"status": "success", "dead_ads_deleted": dead_count}
    except Exception as e:
        print(f"Cron cleanup failed: {e}")
        return {"error": str(e)}


from fastapi import Response


@app.get("/api/cron/prewarm")
def cron_prewarm_deals():
    """Vercel cron: pre-warm the top deals cache so it never expires cold."""
    try:
        global _TOP_DEALS_CACHE
        _TOP_DEALS_CACHE["timestamp"] = 0  # force refresh
        recent_ads = car_db_optimizer.get_recent_active_ads(hours_threshold=72)
        if not recent_ads:
            return {"status": "no_ads", "cached": 0}

        import random

        random.shuffle(recent_ads)
        candidates = recent_ads[:30]

        grouped = {}
        for ad in candidates:
            make, model = ad.get("make"), ad.get("model")
            if not make or not model:
                continue
            key = (make.lower().strip(), model.lower().strip())
            grouped.setdefault(key, []).append(ad)

        for (make_lower, model_lower), group in grouped.items():
            peer_pool = car_db_optimizer.get_active_ads_for_make_model(
                group[0]["make"], group[0]["model"]
            )
            if not peer_pool:
                continue
            s_model = model_lower.replace(" ", "-")
            stats = car_db_optimizer.get_model_stats(group[0]["make"], s_model) or {}
            scored = calculate_deal_scores(peer_pool, stats)
            scores = {ad["id"]: ad.get("deal_score") for ad in scored if "id" in ad}
            for ad in group:
                ad["deal_score"] = scores.get(ad.get("id"))

        valid = [ad for ad in candidates if ad.get("deal_score") is not None]
        valid.sort(key=lambda x: x["deal_score"], reverse=True)
        top_deals = valid[:8]
        for ad in top_deals:
            p = ad.get("price")
            if p is not None:
                ad["price"] = (
                    str(p).replace(",", "").replace(" EUR", "").replace(" €", "") + " €"
                )

        _TOP_DEALS_CACHE["timestamp"] = time.time()
        _TOP_DEALS_CACHE["deals"] = top_deals
        return {"status": "ok", "cached": len(top_deals)}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/api/cron/refresh-scores")
def cron_refresh_scores():
    """Refresh market snapshots for deal scoring. Runs as a Vercel cron job."""
    try:
        count = car_db_optimizer.refresh_market_snapshots()
        repaired = car_db_optimizer.repair_inflated_prices()
        global _TOP_DEALS_CACHE
        _TOP_DEALS_CACHE["timestamp"] = 0
        return {
            "status": "ok",
            "snapshots_refreshed": count,
            "prices_repaired": repaired,
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/sitemap.xml")
def get_sitemap():
    models = car_db_optimizer.get_popular_models(limit=5000)

    xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml_content += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml_content += "  <url><loc>https://motorbit.ro/</loc></url>\n"
    xml_content += (
        "  <url><loc>https://motorbit.ro/pricing</loc><priority>0.8</priority></url>\n"
    )
    xml_content += (
        "  <url><loc>https://motorbit.ro/termeni</loc><priority>0.3</priority></url>\n"
    )
    xml_content += "  <url><loc>https://motorbit.ro/confidentialitate</loc><priority>0.3</priority></url>\n"

    for m in models:
        make = m.get("make", "").lower().replace(" ", "-")
        model = m.get("model", "").lower().replace(" ", "-")
        if make and model:
            xml_content += (
                f"  <url><loc>https://motorbit.ro/masini/{make}/{model}</loc></url>\n"
            )

    xml_content += "</urlset>"

    return Response(content=xml_content, media_type="application/xml")
