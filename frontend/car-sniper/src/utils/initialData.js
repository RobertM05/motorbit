let initialDataPromise = null;
let cachedInitialData = null;

/**
 * Fetches initial-data.json with in-flight request deduplication and memory caching.
 * Prevents multiple components (e.g. SearchContext and DealOfTheDay)
 * from issuing duplicate requests on initial page load.
 */
export async function fetchInitialData() {
  if (cachedInitialData && typeof cachedInitialData === 'object') {
    return cachedInitialData;
  }
  if (!initialDataPromise) {
    initialDataPromise = fetch('/initial-data.json')
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        if (data && typeof data === 'object') {
          cachedInitialData = data;
          return data;
        }
        return null;
      })
      .catch((err) => {
        console.warn('Initial data preload fetch failed:', err?.message);
        return null;
      })
      .finally(() => {
        initialDataPromise = null;
      });
  }
  return initialDataPromise;
}

export function resetInitialDataCache() {
  cachedInitialData = null;
  initialDataPromise = null;
}
