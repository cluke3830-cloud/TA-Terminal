'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const path = usePathname();
  const isActive = (p) => path === p ? 'nav-link active' : 'nav-link';
  return (
    <nav className="app-nav">
      <span className="app-nav-brand">QUANTUM<span className="brand-dot" /></span>
      <Link href="/" className={isActive('/')}>Terminal</Link>
      <Link href="/macro" className={isActive('/macro')}>Macro</Link>
      <span className="app-nav-spacer" />
      <span className="app-nav-tag">AMD HACKATHON · CHAMPIONSHIP EDITION</span>
    </nav>
  );
}