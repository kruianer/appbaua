"use client";

import { useEffect, useState } from "react";

// req-041: Breakpoints für das Layout — bis 743px iPhone (untere Leiste,
// eine Spalte), ab 744px Seitenleiste. Beginnt bei 0 statt window.innerWidth,
// weil die Seite serverseitig gerendert wird und window dort nicht existiert;
// der echte Wert kommt gleich nach dem Mounten über den Effekt nach.
export function useWindowWidth(): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return width;
}
