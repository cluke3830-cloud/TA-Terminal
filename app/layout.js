import './globals.css';
import Script from 'next/script';
import Nav from './components/Nav';
import CommandPalette from './components/CommandPalette';
import ToastHost from './components/ToastHost';
import ShortcutHelp from './components/ShortcutHelp';

export const metadata = {
  title: 'TA Terminal · Equity + Macro',
  description: 'Live Heikin Ashi · IV Surfaces · Earnings · Macro Intelligence',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Nav />
        {children}
        <CommandPalette />
        <ToastHost />
        <ShortcutHelp />
        <Script src="https://cdn.plot.ly/plotly-2.30.0.min.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
