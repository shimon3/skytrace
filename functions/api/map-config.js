export async function onRequestGet(context) {
  const mapTilerKey = String(context.env.MAPTILER_KEY || '').trim();

  return Response.json(
    { mapTilerKey },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
