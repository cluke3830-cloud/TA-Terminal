'use client';

export default function McEmbed({ sym }) {
  const src = `/mc?sym=${encodeURIComponent(sym)}&embed=1`;
  return (
    <iframe
      src={src}
      title="Monte Carlo Pricer"
      style={{
        width: '100%',
        height: 1100,
        border: 'none',
        background: '#111117',
        borderRadius: 'var(--r)',
      }}
    />
  );
}