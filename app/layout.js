import './globals.css';

export const metadata = {
  title: 'Quantum Stock Terminal',
  description: 'Live Heikin Ashi · IV Surfaces · Earnings · Analyst Targets',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
        <script src="https://cdn.plot.ly/plotly-2.30.0.min.js" defer />
      </head>
      <body>{children}</body>
    </html>
  );
}
