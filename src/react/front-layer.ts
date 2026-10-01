/**
 * Which floating window is in front — the annotation card or the property
 * panel. Neither covers the other on its own; the one the designer last
 * touched comes forward, like windows on a desktop.
 */
import { useEffect, useState } from 'react';

const listeners = new Set<(id: string) => void>();

export function useFrontLayer(id: string, startInFront: boolean): [front: boolean, bringToFront: () => void] {
  const [front, setFront] = useState(startInFront);
  useEffect(() => {
    const l = (who: string) => setFront(who === id);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [id]);
  return [front, () => { if (!front) listeners.forEach(l => l(id)); }];
}
