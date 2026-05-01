'use client';

const EXAMPLES = [
  { cmd: 'ADD CHART NVDA 1D D=180', desc: 'Heikin Ashi chart of NVDA · 180 days · live updates' },
  { cmd: 'ADD WATCHLIST', desc: 'mini-quote rows polling every 5 s' },
  { cmd: 'ADD SCREENER', desc: 'predicate filter over the S&P 500' },
  { cmd: 'ADD ALERTS', desc: 'price · IV · MC · news triggers with toasts' },
  { cmd: 'ADD OPT_IV NVDA', desc: 'IV surface for NVDA options' },
  { cmd: 'ADD MACRO_YIELDS', desc: 'live US Treasury yield curve' },
];

export default function EmptyState() {
  return (
    <div className="widget-empty">
      <div className="widget-empty-h">Empty workspace</div>
      <div className="widget-empty-sub">
        Type a command in the bar above, click <b>+ Add widget</b>, or press <kbd>⌘K</kbd> for the global palette.
      </div>
      <div className="widget-empty-grid">
        {EXAMPLES.map((e) => (
          <div key={e.cmd} className="widget-empty-card">
            <div className="widget-empty-cmd">{e.cmd}</div>
            <div className="widget-empty-desc">{e.desc}</div>
          </div>
        ))}
      </div>
      <div className="widget-empty-foot">
        Full reference at <a href="/READ_COMMAND.md" target="_blank" rel="noopener noreferrer">READ_COMMAND.md</a>.
      </div>
    </div>
  );
}