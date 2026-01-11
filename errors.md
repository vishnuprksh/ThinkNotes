# Error Log

## [2026-01-11] FPL Template Pipeline Error: Unexpected token '<'
- **Symptoms**: Error message `Pipeline Error: Error: FPL API Failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` when opening the FPL Analytics template.
- **Cause**: The production environment (Firebase) was missing the `/fpl/` proxy that was configured locally in Vite. Requests to `/fpl/*` were hitting the SPA fallback (index.html), returning HTML instead of JSON.
- **Solution**: 
    1. Created a `proxyFpl` Cloud Function in `functions/src/index.ts` to forward requests to the FPL API.
    2. Added a rewrite rule in `firebase.json` to route `/fpl/**` to the `proxyFpl` function.
    3. Updated `index.ts` system instructions to reflect that the proxy works in production.
- **Status**: Fixed and deployed.
