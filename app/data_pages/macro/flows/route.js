import { getCached, setCache } from '../../_cache';

// IMF COFER reserve currency composition (Q4 2024 latest reported)
const RESERVE_COMPOSITION = [
  { currency: 'USD', share: 57.4, color: '#00d4ff' },
  { currency: 'EUR', share: 19.8, color: '#9955ff' },
  { currency: 'JPY', share: 5.5,  color: '#ff8833' },
  { currency: 'GBP', share: 4.7,  color: '#3377ff' },
  { currency: 'CNY', share: 2.2,  color: '#ff3355' },
  { currency: 'CAD', share: 2.6,  color: '#00f59b' },
  { currency: 'AUD', share: 2.1,  color: '#ffc700' },
  { currency: 'CHF', share: 0.2,  color: '#7a7a90' },
  { currency: 'Other', share: 5.5, color: '#3a3a4d' },
];

// Top FX reserve holders (US$ Bn, World Bank latest annual data approximation)
const RESERVE_HOLDERS = [
  { country: 'China',         iso3: 'CHN', reserves: 3340 },
  { country: 'Japan',         iso3: 'JPN', reserves: 1230 },
  { country: 'Switzerland',   iso3: 'CHE', reserves:  830 },
  { country: 'India',         iso3: 'IND', reserves:  670 },
  { country: 'Russia',        iso3: 'RUS', reserves:  590 },
  { country: 'Taiwan',        iso3: 'TWN', reserves:  570 },
  { country: 'Saudi Arabia',  iso3: 'SAU', reserves:  470 },
  { country: 'Hong Kong',     iso3: 'HKG', reserves:  430 },
  { country: 'South Korea',   iso3: 'KOR', reserves:  420 },
  { country: 'Brazil',        iso3: 'BRA', reserves:  370 },
  { country: 'Singapore',     iso3: 'SGP', reserves:  360 },
  { country: 'Germany',       iso3: 'DEU', reserves:  290 },
  { country: 'Thailand',      iso3: 'THA', reserves:  240 },
  { country: 'France',        iso3: 'FRA', reserves:  240 },
  { country: 'United States', iso3: 'USA', reserves:  240 },
  { country: 'Mexico',        iso3: 'MEX', reserves:  220 },
  { country: 'United Kingdom',iso3: 'GBR', reserves:  190 },
  { country: 'Italy',         iso3: 'ITA', reserves:  220 },
  { country: 'Israel',        iso3: 'ISR', reserves:  210 },
  { country: 'Indonesia',     iso3: 'IDN', reserves:  150 },
  { country: 'Czech Republic',iso3: 'CZE', reserves:  140 },
  { country: 'Poland',        iso3: 'POL', reserves:  220 },
  { country: 'Turkey',        iso3: 'TUR', reserves:  170 },
  { country: 'United Arab Emirates', iso3: 'ARE', reserves: 230 },
  { country: 'Australia',     iso3: 'AUS', reserves:   60 },
  { country: 'Canada',        iso3: 'CAN', reserves:  120 },
];

// Bilateral capital flow approximations (annual, US$ Bn, simplified)
const TRADE_FLOWS = [
  { from: 'USA', to: 'CHN', value: 425, type: 'import' },
  { from: 'CHN', to: 'USA', value: 145, type: 'import' },
  { from: 'USA', to: 'EUR', value: 555, type: 'export' },
  { from: 'EUR', to: 'USA', value: 615, type: 'export' },
  { from: 'CHN', to: 'EUR', value: 510, type: 'export' },
  { from: 'JPN', to: 'USA', value: 145, type: 'export' },
  { from: 'KOR', to: 'CHN', value: 130, type: 'export' },
];

async function worldBankReserves() {
  // Optional live enrichment from World Bank (FI.RES.TOTL.CD)
  try {
    const r = await fetch('https://api.worldbank.org/v2/country/all/indicator/FI.RES.TOTL.CD?format=json&mrnev=1&per_page=300', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !Array.isArray(j[1])) return null;
    return j[1]
      .filter((d) => d.value != null && d.country?.id && d.country.id.length === 3)
      .map((d) => ({
        country: d.country.value,
        iso3: d.countryiso3code || d.country.id,
        reserves: +(d.value / 1e9).toFixed(1),
        year: d.date,
      }))
      .sort((a, b) => b.reserves - a.reserves);
  } catch (_) { return null; }
}

export async function GET() {
  const cached = getCached('macro:flows');
  if (cached) return Response.json(cached);

  let holders = RESERVE_HOLDERS;
  const wb = await worldBankReserves();
  if (wb && wb.length > 10) {
    holders = wb.slice(0, 50).filter((h) => h.iso3 && h.iso3.length === 3);
  }

  const data = {
    reserveComposition: RESERVE_COMPOSITION,
    reserveHolders: holders,
    tradeFlows: TRADE_FLOWS,
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:flows', data);
  return Response.json(data);
}