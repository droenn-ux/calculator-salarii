// src/analytics.ts
const GA_MEASUREMENT_ID = "G-X025466267"; // pune ID-ul tău aici

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

export function loadGA4() {
  if (!GA_MEASUREMENT_ID) return;
  if (document.getElementById("ga4-script")) return; // deja încărcat

  // script gtag.js
  const script = document.createElement("script");
  script.id = "ga4-script";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  // init
  window.dataLayer = window.dataLayer || [];
  function gtag(...args: any[]) {
    window.dataLayer.push(args);
  }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, {
    anonymize_ip: true, // bun pentru GDPR
  });
}
