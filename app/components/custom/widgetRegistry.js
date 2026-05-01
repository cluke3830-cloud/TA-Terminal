'use client';

import dynamic from 'next/dynamic';

const lazy = (loader) => dynamic(loader, { ssr: false, loading: () => <div className="loading"><div className="spinner" />Loading widget…</div> });

export const REGISTRY = {
  CHART:          lazy(() => import('./widgets/ChartWidget')),
  DES:            lazy(() => import('./widgets/DesWidget')),
  EARN:           lazy(() => import('./widgets/EarnWidget')),
  FIN:            lazy(() => import('./widgets/FinWidget')),
  NEWS:           lazy(() => import('./widgets/NewsWidget')),
  OPT_IV:         lazy(() => import('./widgets/OptIVWidget')),
  OPT_GREEKS:     lazy(() => import('./widgets/OptGreeksWidget')),
  OPT_SMILE:      lazy(() => import('./widgets/OptSmileWidget')),
  OPT_TERM:       lazy(() => import('./widgets/OptTermWidget')),
  MC:             lazy(() => import('./widgets/McWidget')),
  MACRO_YIELDS:   lazy(() => import('./widgets/MacroYieldsWidget')),
  MACRO_FX:       lazy(() => import('./widgets/MacroFxWidget')),
  MACRO_COMM:     lazy(() => import('./widgets/MacroCommWidget')),
  MACRO_FLIGHTS:  lazy(() => import('./widgets/MacroFlightsWidget')),
  MACRO_CAL:      lazy(() => import('./widgets/MacroCalWidget')),
  MACRO_FG:       lazy(() => import('./widgets/MacroFgWidget')),
  WATCHLIST:      lazy(() => import('./widgets/WatchlistWidget')),
  ALERTS:         lazy(() => import('./widgets/AlertsWidget')),
  SCREENER:       lazy(() => import('./widgets/ScreenerWidget')),
};

export const WIDGET_META = {
  CHART:         { title: 'Chart',           needsSymbol: true,  defaultSize: { w: 8, h: 2 } },
  DES:           { title: 'Overview',        needsSymbol: true,  defaultSize: { w: 4, h: 1 } },
  EARN:          { title: 'Earnings',        needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  FIN:           { title: 'Financials',      needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  NEWS:          { title: 'News',            needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  OPT_IV:        { title: 'IV Surface',      needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  OPT_GREEKS:    { title: 'Greeks',          needsSymbol: true,  defaultSize: { w: 4, h: 2 } },
  OPT_SMILE:     { title: 'Vol Smile',       needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  OPT_TERM:      { title: 'Term Structure',  needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  MC:            { title: 'Monte Carlo',     needsSymbol: true,  defaultSize: { w: 6, h: 2 } },
  MACRO_YIELDS:  { title: 'Yield Curve',     needsSymbol: false, defaultSize: { w: 6, h: 2 } },
  MACRO_FX:      { title: 'FX Strength',     needsSymbol: false, defaultSize: { w: 6, h: 2 } },
  MACRO_COMM:    { title: 'Commodities',     needsSymbol: false, defaultSize: { w: 6, h: 2 } },
  MACRO_FLIGHTS: { title: 'Flights',         needsSymbol: false, defaultSize: { w: 6, h: 2 } },
  MACRO_CAL:     { title: 'Econ Calendar',   needsSymbol: false, defaultSize: { w: 6, h: 2 } },
  MACRO_FG:      { title: 'Fear / Greed',    needsSymbol: false, defaultSize: { w: 4, h: 1 } },
  WATCHLIST:     { title: 'Watchlist',       needsSymbol: false, defaultSize: { w: 4, h: 2 } },
  ALERTS:        { title: 'Alerts',          needsSymbol: false, defaultSize: { w: 4, h: 2 } },
  SCREENER:      { title: 'Screener',        needsSymbol: false, defaultSize: { w: 12, h: 2 } },
};