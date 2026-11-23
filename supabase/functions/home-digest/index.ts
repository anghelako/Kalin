// Deprecated. Home now builds Today's brief locally. This endpoint never calls an AI provider.
Deno.serve(() => Response.json(
  { code: 'home_digest_retired', message: 'Today’s brief is now available directly on Home.' },
  { status: 410, headers: { 'Cache-Control': 'no-store' } }
));
