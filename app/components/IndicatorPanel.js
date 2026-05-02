'use client';

export default function IndicatorPanel({ indicators, onToggle }) {
  const indicatorGroups = {
    trend: [
      { id: 'sma20', label: 'SMA 20', color: '#ff8833' },
      { id: 'sma50', label: 'SMA 50', color: '#9955ff' },
      { id: 'ema12', label: 'EMA 12', color: '#00d4ff' },
      { id: 'ema26', label: 'EMA 26', color: '#00f59b' },
    ],
    volatility: [
      { id: 'bb20', label: 'Bollinger Bands', color: '#ff8833' },
      { id: 'atr14', label: 'ATR', color: '#ff3355' },
    ],
    momentum: [
      { id: 'rsi14', label: 'RSI (14)', color: '#00d4ff' },
      { id: 'macd', label: 'MACD', color: '#00f59b' },
      { id: 'stoch', label: 'Stochastic', color: '#ff8833' },
    ],
    volume: [
      { id: 'volume', label: 'Volume', color: '#3a7acc' },
    ],
  };

  return (
    <div className="indicator-panel">
      <div className="ip-title">Indicators</div>

      {Object.entries(indicatorGroups).map(([group, items]) => (
        <div key={group} className="ip-group">
          <div className="ip-group-name">{group.charAt(0).toUpperCase() + group.slice(1)}</div>
          {items.map((ind) => (
            <label key={ind.id} className="ip-check">
              <input
                type="checkbox"
                checked={indicators[ind.id] || false}
                onChange={() => onToggle(ind.id)}
              />
              <span className="ip-label">{ind.label}</span>
            </label>
          ))}
        </div>
      ))}

      <style jsx>{`
        .indicator-panel {
          background: var(--onyx);
          border: 1px solid var(--border);
          border-radius: var(--rs);
          padding: 14px;
          position: absolute;
          right: 16px;
          top: 60px;
          width: 200px;
          max-height: 400px;
          overflow-y: auto;
          z-index: 200;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        }

        .ip-title {
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 600;
          color: var(--mist);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }

        .ip-group {
          margin-bottom: 12px;
        }

        .ip-group-name {
          font-family: var(--mono);
          font-size: 9px;
          color: var(--ash);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
        }

        .ip-check {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          cursor: pointer;
          transition: color 0.15s;
        }

        .ip-check:hover {
          color: var(--neon-cyan);
        }

        .ip-check input {
          width: 14px;
          height: 14px;
          cursor: pointer;
          accent-color: var(--neon-cyan);
        }

        .ip-label {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--mist);
          user-select: none;
        }
      `}</style>
    </div>
  );
}