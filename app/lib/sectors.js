// Static ticker → GICS sector map for the macro sentiment heatmap. ~5 bellwether
// names per sector keeps the FinBERT firehose under ~55 headlines per refresh.

export const SECTOR_BELLWETHERS = {
  'Technology':         ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META'],
  'Communication':      ['NFLX', 'DIS', 'TMUS', 'VZ', 'T'],
  'Consumer Disc.':     ['AMZN', 'TSLA', 'HD', 'NKE', 'MCD'],
  'Consumer Staples':   ['PG', 'KO', 'PEP', 'WMT', 'COST'],
  'Financials':         ['JPM', 'BAC', 'GS', 'V', 'MA'],
  'Health Care':        ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV'],
  'Industrials':        ['CAT', 'BA', 'GE', 'UPS', 'HON'],
  'Energy':             ['XOM', 'CVX', 'COP', 'SLB', 'EOG'],
  'Materials':          ['LIN', 'SHW', 'FCX', 'NEM', 'APD'],
  'Real Estate':        ['PLD', 'AMT', 'EQIX', 'CCI', 'SPG'],
  'Utilities':          ['NEE', 'DUK', 'SO', 'AEP', 'D'],
};

export function colorFor(score) {
  if (score == null || isNaN(score)) return 'rgba(85,85,104,0.25)';
  if (score > 0.1) return 'rgba(0,245,155,0.45)';
  if (score < -0.1) return 'rgba(255,51,85,0.45)';
  return 'rgba(234,179,8,0.35)';
}