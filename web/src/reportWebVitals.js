// web-vitals v5: API `getCLS/getFID/...` zastapione przez `onCLS/onINP/...`.
// FID zostal wycofany na rzecz INP (Interaction to Next Paint) — obecnej
// metryki responsywnosci w Core Web Vitals.
const reportWebVitals = onPerfEntry => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
      onCLS(onPerfEntry);
      onINP(onPerfEntry);
      onFCP(onPerfEntry);
      onLCP(onPerfEntry);
      onTTFB(onPerfEntry);
    });
  }
};

export default reportWebVitals;

