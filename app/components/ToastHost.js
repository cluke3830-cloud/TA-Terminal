'use client';

import { useEffect, useState } from 'react';

let nid = 0;

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onToast = (ev) => {
      const id = ++nid;
      const { msg = '', level = 'info' } = ev.detail || {};
      setToasts((prev) => [...prev, { id, msg, level }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    };
    window.addEventListener('qt:toast', onToast);
    return () => window.removeEventListener('qt:toast', onToast);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`} onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}