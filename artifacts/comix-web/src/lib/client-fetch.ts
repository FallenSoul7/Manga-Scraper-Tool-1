/**
 * Compatibility export for native source adapters. The implementation now
 * selects the optional Web Helper, CapacitorHttp, or the Render fallback.
 */
export { clientFetch } from "../services/fetcher";
