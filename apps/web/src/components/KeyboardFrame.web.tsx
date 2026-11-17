import React, { useEffect, useRef, useState } from 'react';
import { KeyboardVisibility } from './keyboardVisibility';

export default function KeyboardFrame({ children }: { children: React.ReactNode }) {
  const baseline = useRef(0);
  const [viewport, setViewport] = useState({ height: 0, top: 0, keyboard: false });
  useEffect(() => {
    const update = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (!editing || !baseline.current) baseline.current = window.innerHeight;
      const visual = window.visualViewport;
      const unzoomed = !visual || Math.abs(visual.scale - 1) < 0.01;
      const height = unzoomed && visual ? visual.height : window.innerHeight;
      const top = unzoomed && visual ? visual.offsetTop : 0;
      const keyboard = editing && baseline.current - height > 100;
      setViewport(current => current.height === height && current.top === top && current.keyboard === keyboard
        ? current : { height, top, keyboard });
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return <KeyboardVisibility.Provider value={viewport.keyboard}>
    <div style={{ position: 'fixed', top: viewport.top, left: 0, width: '100%', height: viewport.height || '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {children}
    </div>
  </KeyboardVisibility.Provider>;
}
