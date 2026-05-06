'use client';
import { useEffect, useState } from 'react';

function Bar({ pct, color = 'var(--amd-red)' }) {
  const v = parseFloat(pct) || 0;
  return (
    <div style={{ background: 'var(--onyx)', borderRadius: 4, height: 6, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${Math.min(v, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .6s ease' }} />
    </div>
  );
}

function Metric({ label, value, unit, pct, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--white)', fontWeight: 600 }}>
          {value != null ? `${parseFloat(value).toFixed(1)}${unit}` : '—'}
        </span>
      </div>
      {pct != null && <Bar pct={pct} color={color} />}
    </div>
  );
}

export default function AMDTelemetryCard() {
  const [data, setData] = useState(null);
  const [ts, setTs] = useState(null);

  async function poll() {
    try {
      const r = await fetch('/api/amd-telemetry');
      const j = await r.json();
      setData(j);
      setTs(new Date().toLocaleTimeString());
    } catch {}
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  const online = data?.status === 'online';

  return (
    <div className="card fi fi3" style={{ borderTop: '2px solid #ED1C24' }}>
      <div className="card-header" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="#ED1C24" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="card-title">MI300X Telemetry</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px',
            borderRadius: 4, fontWeight: 700, letterSpacing: '.7px',
            background: online ? 'rgba(237,28,36,0.12)' : 'rgba(90,90,120,0.2)',
            color: online ? 'var(--amd-red)' : 'var(--smoke)',
            border: `1px solid ${online ? 'rgba(237,28,36,0.28)' : 'var(--border)'}`,
            transition: 'background .15s, color .15s, border-color .15s',
          }}>
            {online ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        {ts && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)' }}>{ts}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amd-red)', fontWeight: 700, letterSpacing: '.5px', marginBottom: 2 }}>
          {data?.gpu || 'AMD Instinct MI300X'} · ROCm {data?.rocm_version || '7.1'}
        </div>

        <Metric label="GPU Util" value={data?.gpu_util_pct} unit="%" pct={data?.gpu_util_pct} color="#ED1C24" />
        <Metric label="VRAM Used" value={data?.vram_used_pct} unit="%" pct={data?.vram_used_pct} color="#ff6622" />
        <Metric label="Temp" value={data?.temp_c} unit="°C" pct={data?.temp_c ? Math.min(parseFloat(data.temp_c) / 110 * 100, 100) : null} color="#ffc700" />
        <Metric label="Power" value={data?.power_w} unit="W" pct={data?.power_w ? Math.min(parseFloat(data.power_w) / 750 * 100, 100) : null} color="#3377ff" />

        {!online && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)', textAlign: 'center', paddingTop: 4 }}>
            GPU Droplet offline or unreachable
          </div>
        )}
      </div>
    </div>
  );
}