module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  res.status(200).json({
    mapboxPublicToken: process.env.MAPBOX_PUBLIC_TOKEN || '',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
};
