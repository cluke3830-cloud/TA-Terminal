'use client';

import { Suspense } from 'react';
import CustomSearchBar from '../components/custom/CustomSearchBar';
import Workspace from '../components/custom/Workspace';

export default function CustomPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading workspace…</div>}>
      <CustomInner />
    </Suspense>
  );
}

function CustomInner() {
  return (
    <main className="custom-page">
      <CustomSearchBar />
      <Workspace />
    </main>
  );
}