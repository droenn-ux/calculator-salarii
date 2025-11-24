import React, { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";
// --- utils date ---
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d: Date, k: number) => {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + k);
  return x;
};

// Paștele ortodox (gregorian) – variantă pentru RO (1900–2099)
function orthodoxEasterDate(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  // +13 zile diferență iulian → gregorian (valabil în intervalul curent)
  return new Date(year, month - 1, day + 13);
}

// Sărbători legale RO cu nume (format YYYY-MM-DD + name)
function getRomanianHolidaysWithNames(year: number): { date: string; name: string }[] {
  const fixed = [
    [`${year}-01-01`, "Anul Nou"],
    [`${year}-01-02`, "A doua zi de Anul Nou"],
    [`${year}-01-06`, "Boboteaza"],
    [`${year}-01-07`, "Sf. Ion"],
    [`${year}-01-24`, "Unirea Principatelor"],
    [`${year}-05-01`, "Ziua Muncii"],
    [`${year}-06-01`, "Ziua Copilului"],
    [`${year}-08-15`, "Adormirea Maicii Domnului"],
    [`${year}-11-30`, "Sf. Andrei"],
    [`${year}-12-01`, "Ziua Națională"],
    [`${year}-12-25`, "Crăciunul"],
    [`${year}-12-26`, "A doua zi de Crăciun"],
  ] as const;

  const easter = orthodoxEasterDate(year);
  const goodFriday = addDays(easter, -2);
  const easterMon = addDays(easter, 1);
  const pentecost = addDays(easter, 49);
  const pentecostMon = addDays(easter, 50);

  const moveable = [
    [ymd(goodFriday), "Vinerea Mare"],
    [ymd(easter), "Paștele (duminică)"],
    [ymd(easterMon), "A doua zi de Paște (luni)"],
    [ymd(pentecost), "Rusaliile (duminică)"],
    [ymd(pentecostMon), "A doua zi de Rusalii (luni)"],
  ] as const;

  return [...fixed, ...moveable].map(([date, name]) => ({ date, name }));
}


/**
 * Calculator salarii – React + Tailwind (TS)
 * - Brut → Net și Net → Brut
 * - Input text cu parsare manuală (poți șterge 0 fără probleme)
 * - Rate configurabile rapid (CAS/CASS/Impozit/CAM)
 */

type Rates = { CAS: number; CASS: number; TAX: number; CAM: number };

// --- Setări legale 2025 (poți face și configurabile din UI)
const MIN_WAGE_2025 = 4050;

// % din salariul minim pentru deducere de bază, în funcție de persoane în întreținere
// 0 dep: 20%, 1 dep: 25%, 2 dep: 30%, 3 dep: 35%, >=4 dep: 45%
function getDPmaxPercent(dependents: number) {
  if (dependents >= 4) return 0.45;
  const map = [0.20, 0.25, 0.30, 0.35];
  return map[Math.max(0, Math.min(3, dependents))];
}

/**
 * Deducere personală 2025:
 * - DPmax = % * salariul minim (în funcție de nr. dependenți)
 * - scade liniar până la 0 între [minim, minim+2000]
 */
function getPersonalDeduction2025(gross: number, dependents: number, minWage = MIN_WAGE_2025) {
  const DPmax = getDPmaxPercent(dependents) * minWage;
  if (gross <= minWage) return DPmax;
  const upper = minWage + 2000;
  if (gross >= upper) return 0;
  const t = (upper - gross) / 2000; // fade liniar
  return DPmax * t;
}


/**
 * Facilitatea „300 lei netaxabili” la salariul minim (2025):
 * - cei 300 lei NU intră în baza CAS/CASS și NICI în baza de impozit.
 * - se aplică pentru salariul minim general (4050 lei).
 * Observație: pentru 4050, asta înseamnă:
 *   CAS = 25% * (4050 - 300)
 *   CASS = 10% * (4050 - 300)
 *   Baza impozit = 4050 - CAS - CASS - DP - 300
 */
function shouldApply300Relief(gross: number, minWage = MIN_WAGE_2025) {
  // aplicăm DOAR la salariul minim (toleranță mică pt. zecimale)
  return Math.abs(gross - minWage) < 0.5;
}
type ThemeMode = "light" | "dark" | "system";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const body = document.body;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const nextDark = mode === "dark" || (mode === "system" && sysDark);
  console.debug("[theme]", { mode, sysDark, nextDark });
  root.classList.toggle("dark", nextDark);
  body?.classList.toggle("dark", nextDark);
}

function useThemeMode() {
  const [theme, setTheme] = React.useState<ThemeMode>(() => {
    const saved = localStorage.getItem("theme") as ThemeMode | null;
    return saved ?? "system";
  });

  React.useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("theme", theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  return { theme, setTheme };
}

function ThemeToggle({ theme, setTheme }: { theme: ThemeMode; setTheme: (t: ThemeMode)=>void }) {
  const [open, setOpen] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const Item = ({ value, label }: { value: ThemeMode; label: string }) => (
    <button
      onClick={() => { setTheme(value); setOpen(false); }}
      className={`w-full text-left px-3 py-2 rounded-lg border transition
        ${theme === value
          ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
      title={label}
    >
      <span className="flex items-center justify-between">
        {label}
        {theme === value && <span className="ml-3 inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />}
      </span>
    </button>
  );

  const activeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";
  const icon = theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️";

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(v => !v)}
        type="button"
        aria-label={`Schimbă tema (curent: ${activeLabel})`}
        className="inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-slate-200 bg-white/90 text-lg
                   text-slate-700 shadow-sm hover:border-slate-400 hover:bg-white transition
                   dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-400"
      >
        <span aria-hidden>{icon}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 p-2 rounded-xl bg-white border border-slate-200 shadow-md
                        dark:bg-slate-800 dark:border-slate-700">
          <Item value="system" label="System" />
          <div className="h-px my-2 bg-slate-200 dark:bg-slate-700" />
          <Item value="light" label="Light" />
          <Item value="dark"  label="Dark" />
        </div>
      )}
    </div>
  );
}


export default function App() {
  // folosim string pentru input ca să poți șterge complet valoarea
  const [mode, setMode] = useState<"GROSS_TO_NET" | "NET_TO_GROSS">(
    "GROSS_TO_NET"
  );
  const [grossStr, setGrossStr] = useState("7000");
  const [netStr, setNetStr] = useState("");
 // Setări fiscale 2025
  const [dependents, setDependents] = useState(0);   // persoane în întreținere (0..4)
  const [page, setPage] = React.useState<"home" | "about" | "workdays">("home");
const [toast, setToast] = useState<{ msg: string; visible: boolean }>({
  msg: "",
  visible: false,
});
const { theme, setTheme } = useThemeMode();
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
const [cookieConsent, setCookieConsent] = useState<"unknown" | "accepted" | "rejected">("unknown");


useEffect(() => {
  const m = getParam("mode");
  const g = getParam("gross");
  const n = getParam("net");
  const d = getParam("dep");

  if (m === "NET_TO_GROSS" || m === "GROSS_TO_NET") setMode(m as any);
  if (g) setGrossStr(g.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
  if (n) setNetStr(n.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
  if (d) setDependents(Number(d));
}, []);
useEffect(() => {
  setSearchParam("mode", mode);
}, [mode]);

useEffect(() => {
  // scoatem punctele ca să punem numărul „curat” în URL
  const raw = grossStr.replace(/\D/g, "");
  setSearchParam("gross", raw || undefined);
}, [grossStr]);

useEffect(() => {
  const raw = netStr.replace(/\D/g, "");
  setSearchParam("net", raw || undefined);
}, [netStr]);

useEffect(() => {
  setSearchParam("dep", dependents);
}, [dependents]);

useEffect(() => {
  setMobileMenuOpen(false);
}, [page]);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setMobileMenuOpen(false);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

useEffect(() => {
  const saved = localStorage.getItem("cookie_consent");
  if (saved === "accepted") {
    setCookieConsent("accepted");
    // încarcă GA4 direct
    import("./analytics").then(mod => mod.loadGA4());
  } else if (saved === "rejected") {
    setCookieConsent("rejected");
  } else {
    setCookieConsent("unknown");
  }
}, []);


  const [rates] = useState<Rates>({
    CAS: 25,
    CASS: 10,
    TAX: 10,
    CAM: 2.25,
  });

  const [rounding] = useState(true);

  // conversie sigură: gestionează mii cu puncte, zecimale cu virgulă/punct
// Transformă "4.050" în 4050, "12 300" în 12300, "8,200" în 8200 (doar cifre!)
const toNumber = (s: string) => {
  const digits = (s ?? "").replace(/\D/g, ""); // păstrează DOAR cifrele 0-9
  return digits ? Number(digits) : 0;
};

  // Curs EUR (1 RON -> EUR). Folosim Frankfurter (ECB)
const [eurRate, setEurRate] = useState<number>(0.20); // 1 RON ≈ 0.20 EUR (fallback)
const [eurDate, setEurDate] = useState<string>("");


useEffect(() => {
  (async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=RON&to=EUR");
      const data = await res.json();
      const rate = data?.rates?.EUR;
      if (rate && typeof rate === "number") {
        setEurRate(rate);          // EUR per 1 RON
        setEurDate(data?.date || "");
      }
    } catch (_) {
      // lăsăm fallback-ul
    }
  })();
}, []);

function showToast(msg: string) {
  setToast({ msg, visible: true });
  setTimeout(() => setToast({ msg: "", visible: false }), 2000);
}

const handleCopyLink = React.useCallback(async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("✅ Link copiat!");
  } catch {
    showToast("❌ Nu s-a putut copia linkul");
  }
}, []);

  const gross = toNumber(grossStr);
  const netDesired = toNumber(netStr);

  function computeFromGross(g: number) {
  // 300 netaxabili la salariul minim (automat)
  const has300 = shouldApply300Relief(g, MIN_WAGE_2025);
  const relief300 = has300 ? 300 : 0;

  // deducere personală: automată sau manuală din input
 // deducere personală: mereu automată (2025)
const DP = getPersonalDeduction2025(g, dependents, MIN_WAGE_2025);

  // Baza pentru CAS/CASS exclude cei 300 (dacă se aplică)
  const baseContrib = Math.max(0, g - relief300);

  const CAS_raw  = (rates.CAS  / 100) * baseContrib;
  const CASS_raw = (rates.CASS / 100) * baseContrib;

  const CAS  = rounding ? Math.round(CAS_raw)  : CAS_raw;
  const CASS = rounding ? Math.round(CASS_raw) : CASS_raw;

  // Baza de impozit exclude și cei 300
  const taxable = Math.max(0, g - CAS - CASS - DP - relief300);

  const tax_raw = (rates.TAX / 100) * taxable;
  const tax     = rounding ? Math.round(tax_raw) : tax_raw;

  const NET = g - CAS - CASS - tax;

  // CAM pe brut integral
  const CAM_raw = (rates.CAM / 100) * g;
  const CAM     = rounding ? Math.round(CAM_raw) : CAM_raw;

  const EMPLOYER_COST = g + CAM;
  

  return { CAS, CASS, tax, NET, CAM, EMPLOYER_COST, taxable, DP, relief300 };
}

function setSearchParam(key: string, value: string | number | undefined) {
  const u = new URL(window.location.href);
  if (value === undefined || value === null || value === "") u.searchParams.delete(key);
  else u.searchParams.set(key, String(value));
  window.history.replaceState({}, "", u.toString());
}

function getParam(name: string) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}


 function solveGrossForNet(targetNet: number) {
  let lo = 0, hi = Math.max(1, targetNet * 3 + 10000); // bound realist
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const { NET } = computeFromGross(mid);
    if (NET < targetNet) lo = mid; else hi = mid;
  }
  return hi;
}


  const result = useMemo(() => {
    if (mode === "GROSS_TO_NET") return computeFromGross(gross || 0);
    const g = solveGrossForNet(netDesired || 0);
    return { ...computeFromGross(g), solvedGross: g };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gross, netDesired, rates, rounding, dependents]);

  const displayGross = mode === "GROSS_TO_NET" ? gross : (result as any).solvedGross;

  const fmtRON = (n: number) =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    minimumFractionDigits: rounding ? 0 : 2,
    maximumFractionDigits: rounding ? 0 : 2,
  }).format(Number.isFinite(n) ? (rounding ? Math.round(n) : n) : 0);

  const fmtEUR = (nRON: number) =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((Number.isFinite(nRON) ? nRON : 0) * eurRate);

  const handleExportPayslip = React.useCallback(() => {
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const now = new Date();
      const fmtRONpdf = (val?: number) =>
        `${new Intl.NumberFormat("ro-RO", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(Math.round(val ?? 0))} lei`;

      const addRows = (
        rows: Array<[string, number | undefined]>,
        startY: number
      ) => {
        let y = startY;
        rows.forEach(([label, value]) => {
          doc.text(label, 40, y);
          doc.text(fmtRONpdf(value), 520, y, { align: "right" });
          y += 18;
        });
        return y;
      };

      doc.setFontSize(18);
      doc.text("Fluturas salariu", 40, 60);
      doc.setFontSize(11);
      doc.text(`Persoane în întreținere: ${dependents}`, 40, 82);
      doc.text(`Salariu brut: ${fmtRONpdf(displayGross || 0)}`, 40, 100);

      const drawSection = (
        title: string,
        rows: Array<[string, number | undefined]>,
        startY: number
      ) => {
        let y = startY;
        doc.setFontSize(13);
        doc.text(title, 40, y);
        y += 16;
        doc.setFontSize(10);
        doc.text("Categorie", 40, y);
        doc.text("RON", 520, y, { align: "right" });
        y += 8;
        doc.setDrawColor(210);
        doc.line(40, y, 540, y);
        y += 14;
        return addRows(rows, y) + 10;
      };

      const employeeRows: Array<[string, number | undefined]> = [
        ["CAS (25%)", result.CAS],
        ["CASS (10%)", result.CASS],
        ["Bază impozabilă", result.taxable],
        ["Impozit pe venit (10%)", result.tax],
      ];
      const employerRows: Array<[string, number | undefined]> = [
        ["CAM (2.25%)", result.CAM],
        ["Cost total angajator", result.EMPLOYER_COST],
      ];
      let cursorY = 130;
      cursorY = drawSection("Angajat", employeeRows, cursorY);
      cursorY = drawSection("Angajator", employerRows, cursorY + 4);

      const deductions: Array<[string, number | undefined]> = [];
      if (result?.DP > 0) deductions.push(["Deducere personală", result.DP]);
      if (result?.relief300 > 0) deductions.push(["300 lei netaxabili", result.relief300]);
      if (deductions.length) {
        cursorY = drawSection("Deduceri aplicate", deductions, cursorY + 8);
      }

      const finalY = Math.min(cursorY + 40, 760);
      doc.setFontSize(14);
      doc.text(`Salariu net: ${fmtRONpdf(result.NET || 0)}`, 40, finalY);

      doc.setFontSize(9);
      doc.text(
        `Fluturas generat ${now.toLocaleDateString("ro-RO")} – valori orientative.`,
        40,
        780
      );

      doc.save(`fluturas-salariu-${ymd(now)}.pdf`);
      showToast("✅ Fluturaș PDF salvat");
    } catch (err) {
      console.error(err);
      showToast("❌ Nu am putut genera fluturașul");
    }
  }, [dependents, displayGross, result]);


    // ✅ ROUTING simplu – întoarce direct pagina și oprește execuția
  if (page === "about")    return <AboutPage onBack={() => setPage("home")} />;
  if (page === "workdays") return <WorkingDaysPage onBack={() => setPage("home")} />;

  return (
    <div className="min-h-screen w-full flex flex-col overflow-x-hidden 
  bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 dark:text-slate-100
  dark:from-slate-900 dark:to-slate-950 dark:text-slate-100">

      {/* Header */}
<header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-indigo-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)]
  dark:bg-slate-900/70 dark:border-slate-800">

  <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
    {/* stânga: logo + titlu */}
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-2xl bg-slate-900 text-white grid place-items-center font-bold">CS</div>
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold leading-tight">Calculator salarii</h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">Rapid, clar, responsiv</p>
      </div>
    </div>

    {/* dreapta: acțiuni */}
    <div className="flex items-center gap-2">
      <ThemeToggle theme={theme} setTheme={setTheme} />
      <div className="sm:hidden relative">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-expanded={mobileMenuOpen}
          className="inline-flex items-center justify-center rounded-2xl px-3 py-2 border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
        >
          <span className="sr-only">Deschide meniul</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {mobileMenuOpen && (
          <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-slate-200 bg-white/95 shadow-lg dark:bg-slate-800 dark:border-slate-700 z-10">
            <button
              type="button"
              onClick={() => { setPage("workdays"); setMobileMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/60"
            >
              Zile lucrătoare
            </button>
            <button
              type="button"
              onClick={() => { setPage("about"); setMobileMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/60"
            >
              Despre & Setări
            </button>
            <button
              type="button"
              onClick={() => { handleCopyLink(); setMobileMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/60"
            >
              Copiază link
            </button>
          </div>
        )}
      </div>
      <button
        className="hidden sm:inline-flex items-center gap-2 rounded-2xl px-4 py-2
                   bg-white border border-slate-300 text-slate-700 dark:text-slate-200 hover:border-slate-400 transition
                   dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
        onClick={() => setPage("workdays")}
      >
        Zile lucrătoare
      </button>

      <a
        href="#"
        className="hidden sm:inline-flex items-center gap-2 rounded-2xl px-4 py-2
                   bg-slate-700 text-white shadow-sm hover:bg-slate-800 hover:shadow-md transition"
        onClick={(e) => { e.preventDefault(); setPage("about"); }}
      >
        Despre & Setări
      </a>

      <button
        className="hidden sm:inline-flex items-center gap-2 rounded-2xl px-4 py-2
                   bg-white border border-slate-300 text-slate-700 dark:text-slate-200 hover:border-slate-400 transition
                   dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
        onClick={handleCopyLink}
      >
        Copiază link
      </button>
    </div>
  </div>
</header>


      {/* Main */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-4 grid gap-4 lg:grid-cols-12 ">
       {/* Inputs */}
<section className="lg:col-span-8">
  <div className="grid gap-4">
    <ModeToggle mode={mode} setMode={setMode} />

    <div className="grid gap-3 sm:grid-cols-2 ">
      {mode === "GROSS_TO_NET" ? (
        <MoneyInput
          label="Salariu brut"
          value={grossStr}
          setValue={setGrossStr}
          suffix="lei"
        />
      ) : (
        <MoneyInput
          label="Salariu net dorit"
          value={netStr}
          setValue={setNetStr}
          suffix="lei"
        />
      )}

      {/* Selector persoane în întreținere */}
      <label className="p-3 rounded-xl bg-white shadow-sm border border-slate-200 flex flex-col gap-2 dark:bg-slate-800/80 dark:border-slate-700">
        <span className="text-sm text-slate-600 dark:text-slate-300">Persoane în întreținere</span>
        <select
          value={dependents}
          onChange={(e) => setDependents(Number(e.target.value))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/10 dark:bg-slate-800/80 dark:border-slate-700"
        >
          <option value={0}>0</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4+</option>
        </select>
      </label>
    </div>

    {/* Rezumate */}
    <div className="grid gap-4 sm:grid-cols-2 ">
      <div className="opacity-0 animate-[fade-in-up_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:200ms] ">
        <StatCard
  title="Salariu brut"
  value={fmtRON(displayGross || 0)}
  highlight={mode === "NET_TO_GROSS"}   // <— evidențiază BRUT când vrei să ajungi la brut
/>
      </div>
      <div className="opacity-0 animate-[fade-in-up_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:240ms]">
       <StatCard
  title="Salariu net"
  value={fmtRON(result.NET || 0)}
  highlight={mode === "GROSS_TO_NET"}   // <— evidențiază NET când calculezi din brut
/>
      </div>
    </div>
            {/* Breakdown cu delimitatoare */}
            <Breakdown result={result} fmtRON={fmtRON} fmtEUR={fmtEUR} eurRate={eurRate} eurDate={eurDate} onExportPayslip={handleExportPayslip} />
          </div>
        </section>

        {/* Setări */}
        <aside className="lg:col-span-4">
  <div className="grid gap-4 ">
    <GuideCard />
    <InfoCard />
  </div>
</aside>

      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-indigo-100 bg-white/60 backdrop-blur-sm dark:bg-slate-800/80 dark:border-slate-700" >
        <div className="max-w-7xl mx-auto px-4 py-4 text-sm text-slate-600 dark:text-slate-300 grid gap-2 md:flex md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Calculator salarii – Interfață modernă.</p>
          <p>Atenție: instrument informativ. Verificați legislația curentă.</p>
        </div>
      </footer>
      {toast.visible && (
  <div
    className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl
               bg-green-600 text-white text-sm shadow-lg
               animate-[fade-in-up_0.3s_ease-out]
               pointer-events-none select-none"
  >
    {toast.msg}
  </div>
)}
{cookieConsent === "unknown" && (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-lg w-[95%] 
                  rounded-2xl bg-slate-900 text-slate-50 px-4 py-3 
                  shadow-xl border border-slate-700 text-sm flex flex-col gap-2
                  md:flex-row md:items-center md:gap-3 z-50">
    <div className="flex-1">
      Folosim cookie-uri pentru a analiza traficul (Google Analytics 4).
      Poți folosi site-ul și fără să accepți analiza.
    </div>
    <div className="flex gap-2 justify-end mt-2 md:mt-0">
      <button
        className="px-3 py-1.5 rounded-xl border border-slate-600 
                   bg-slate-800 hover:bg-slate-700 text-xs"
        onClick={() => {
          localStorage.setItem("cookie_consent", "rejected");
          setCookieConsent("rejected");
        }}
      >
        Refuz
      </button>
      <button
        className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 
                   text-xs font-semibold text-slate-900 rounded-xl"
        onClick={async () => {
          localStorage.setItem("cookie_consent", "accepted");
          setCookieConsent("accepted");
          const mod = await import("./analytics");
          mod.loadGA4();
        }}
      >
        Accept
      </button>
    </div>
  </div>
)}

    </div>
  );
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: "GROSS_TO_NET" | "NET_TO_GROSS";
  setMode: (m: "GROSS_TO_NET" | "NET_TO_GROSS") => void;
}) {
  return (
     <div className="p-3 rounded-xl bg-white shadow-sm border border-slate-200 opacity-0 animate-[fade-in-up_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:80ms] dark:bg-slate-800/80 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
       <button
  className={`px-4 py-2 rounded-xl border transition
    ${mode === "GROSS_TO_NET"
      ? "bg-slate-900 text-white border-slate-900 shadow dark:bg-white dark:text-slate-900 dark:border-white"
      : "bg-white border-slate-300 text-slate-700 hover:border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
    }`}
  onClick={() => setMode("GROSS_TO_NET")}
>
  Brut → Net
</button>

<button
  className={`px-4 py-2 rounded-xl border transition
    ${mode === "NET_TO_GROSS"
      ? "bg-slate-900 text-white border-slate-900 shadow dark:bg-white dark:text-slate-900 dark:border-white"
      : "bg-white border-slate-300 text-slate-700 hover:border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
    }`}
  onClick={() => setMode("NET_TO_GROSS")}
>
  Net → Brut
</button>
        <p className="text-sm text-slate-600 dark:text-slate-300 ml-auto ">Alege direcția de calcul.</p>
      </div>
    </div>
  );
}

function MoneyInput({
  label,
  value,
  setValue,
  suffix,
  hint,
}: {
  label: string;
  value: string;                         // ex: "12.300"
  setValue: (v: string) => void;         // setează stringul formatat
  suffix?: string;
  hint?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const raw = input.value;

    // nr. de cifre înainte de caret (pt. a-l re-poziționa corect după formatare)
    const caret = input.selectionStart ?? raw.length;
    const digitsBefore = (raw.slice(0, caret).match(/\d/g) || []).length;

    // păstrăm DOAR cifrele (fără minus, fără litere)
    let digits = raw.replace(/\D/g, "");

    // scoatem zerourile de la început (dar lăsăm măcar un „0” dacă e gol)
    digits = digits.replace(/^0+(?=\d)/, "");

    // formatare cu punct la mii: 12345 -> 12.345
    const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    setValue(formatted);

    // repoziționează caret-ul la același număr de cifre
    requestAnimationFrame(() => {
      if (!ref.current) return;
      let pos = 0, count = 0;
      while (pos < formatted.length && count < digitsBefore) {
        if (/\d/.test(formatted[pos])) count++;
        pos++;
      }
      ref.current.setSelectionRange(pos, pos);
    });
  };

  return (
    <label className="p-3 rounded-xl bg-white shadow-sm border border-slate-200 flex flex-col gap-2 dark:bg-slate-800/80 dark:border-slate-700">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
           focus:ring-2 focus:ring-slate-900/10
           dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:focus:ring-white/10"
          value={value}
          onChange={handleChange}
          placeholder="0"
        />
        {suffix && (
          <span className="text-slate-600 dark:text-slate-300 text-sm bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 dark:bg-slate-800/80 dark:border-slate-700">
            {suffix}
          </span>
        )}
      </div>
      {hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}


function StatCard({ title, value, highlight = false }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`p-4 rounded-xl border
        ${highlight
          ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
          : "bg-white border-slate-300 text-slate-700 hover:border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
        }`}
    >
      <div className="text-sm opacity-80">{title}</div>
      <div className="text-xl font-semibold tracking-tight mt-1">{value}</div>
    </div>
  );
}


function Breakdown({
  result,
  fmtRON,
  fmtEUR,
  eurRate,
  eurDate,
  onExportPayslip,
}: {
  result: any;
  fmtRON: (n: number) => string;
  fmtEUR: (n: number) => string;
  eurRate: number;
  eurDate: string;
  onExportPayslip: () => void;
}) {


  return (
    <div className="grid gap-4 lg:grid-cols-12 items-start">
      {/* === Curs valutar === */}
<div className="lg:col-span-12 p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between dark:bg-slate-800/80 dark:border-slate-700">
  <div>
    <div className="text-sm text-slate-600 dark:text-slate-300">Curs valutar (ECB)</div>
    <div className="text-xs text-slate-500 dark:text-slate-400">
      {eurDate ? `Actualizat ${eurDate}` : "Actualizare automată"}
    </div>
  </div>
  <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
    1 EUR = { (eurRate ? (1 / eurRate) : 0).toFixed(4) } RON
  </div>
</div>
      {/* ===== Tabel 1: Angajat (RON & EUR) */}
      <div className="lg:col-span-6 p-4 rounded-xl bg-white/90 border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col justify-end h-full dark:bg-slate-800/80 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3 mb-3 ">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Angajat</h3>
          <button
            type="button"
            onClick={onExportPayslip}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm bg-slate-900 text-white shadow hover:bg-slate-800 transition dark:bg-white dark:text-slate-900 dark:border dark:border-slate-300"
          >
            📄 Exportă PDF
          </button>
        </div>

        <table className="table-fixed w-full text-[13px] border-separate border-spacing-y-1 tabular-nums dark:bg-slate-800/80 dark:border-slate-700">

  {/* lățimi consecvente: 55% / 25% / 20% */}
  <colgroup>
    <col style={{ width: "40%", borderLeft: "1px solid rgba(0,0,0,0.05)" }} />
    <col style={{ width: "30%",  borderLeft: "1px solid rgba(0,0,0,0.05)" }} />
    <col style={{ width: "30%", borderLeft: "1px solid rgba(0,0,0,0.05)" }} />
  </colgroup>

  <thead className="tabular-nums">
    <tr className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide ">
      <th className="text-left pl-2.5 py-1.5">Categorie</th>
      <th className="text-right px-2.5 py-1.5">RON</th>
      <th className="text-right pr-2.5 py-1.5">EUR</th>
    </tr>
  </thead>
  <tbody className="tabular-nums">
            {[
              ["CAS (25%)", result.CAS],
              ["CASS (10%)", result.CASS],
              ["Bază impozabilă", result.taxable],
              ["Impozit pe venit (10%)", result.tax],
              ["Salariu net", result.NET],
            ].map(([label, value]: any[], i) => (
              <tr
  key={i}
  className={`transition border border-slate-200 rounded-lg shadow-sm dark:bg-slate-800/80 dark:border-slate-700 ${
    i === 4
      ? "bg-slate-500 text-white font-semibold"
      : "bg-white/90 hover:bg-slate-50"
  }`}
>
  <td className="px-2.5 py-1.5 rounded-l-xl">{label}</td>
  <td className="px-2.5 py-1.5 text-right">{fmtRON(value || 0)}</td>
  <td className="px-2.5 py-1.5 text-right rounded-r-xl font-medium">
    {fmtEUR(value || 0)}
  </td>
</tr>

            ))}
          </tbody>
        </table>
      </div>

      {/* ===== Tabel 2: Angajator (costuri suplimentare) */}
<div className="lg:col-span-6 p-4 rounded-xl bg-white/90 border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col h-full dark:bg-slate-800/80 dark:border-slate-700">
  <h3 className="text-lg font-semibold mb-3 text-slate-800 dark:text-slate-100">Angajator</h3>

  <table className="table-fixed w-full text-[13px] border-separate border-spacing-y-1 tabular-nums dark:bg-slate-800/80 dark:border-slate-700">
    <colgroup>
      <col style={{ width: "40%" }} />
      <col style={{ width: "30%" }} />
      <col style={{ width: "30%" }} />
    </colgroup>
    <thead>
      <tr className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide ">
        <th className="text-left pl-2.5 py-1.5">Categorie</th>
        <th className="text-right px-2.5 py-1.5">RON</th>
        <th className="text-right pr-2.5 py-1.5">EUR</th>
      </tr>
    </thead>
    <tbody>
      {[
        ["CAM (2.25%)", result.CAM],
        ["Cost total angajator", result.EMPLOYER_COST],
      ].map(([label, value]: any[], i) => (
        <tr
          key={i}
          className={`transition border border-slate-200 rounded-lg shadow-sm dark:bg-slate-800/80 dark:border-slate-700 ${
            i === 1 ? "bg-slate-500 text-white font-semibold" : "bg-white/90 hover:bg-slate-50 "
          }`}
        >
          <td className="px-2.5 py-1.5 rounded-l-xl">{label}</td>
          <td className="px-2.5 py-1.5 text-right">{fmtRON(value || 0)}</td>
          <td className="px-2.5 py-1.5 text-right rounded-r-xl font-medium">
            {fmtEUR(value || 0)}
          </td>
        </tr>
      ))}
    </tbody>
  </table>


  {/* --- Zona separată: Deduceri aplicate --- */}
{(result?.DP > 0 || result?.relief300 > 0) && (
  <div className="mt-4 rounded-xl border bg-white/95 p-4 shadow-sm
                  border-slate-200 dark:bg-slate-800/90 dark:border-slate-700">
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Deduceri aplicate
      </h4>
    </div>

    <div className="grid gap-2 text-[13px]">
      {result?.DP > 0 && (
        <div className="flex items-center justify-between rounded-lg border
                        bg-sky-50/80 text-slate-800
                        border-sky-200 px-3 py-2
                        dark:bg-sky-900/20 dark:border-sky-800 dark:text-slate-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full
                             bg-sky-500 text-white text-[11px]">✓</span>
            <span className="text-sm">Deducere personală</span>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{fmtRON(result.DP)}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{fmtEUR(result.DP)}</div>
          </div>
        </div>
      )}

      {result?.relief300 > 0 && (
        <div className="flex items-center justify-between rounded-lg border
                        bg-emerald-50/80 text-slate-800
                        border-emerald-200 px-3 py-2
                        dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-slate-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full
                             bg-emerald-500 text-white text-[11px]">✓</span>
            <span className="text-sm">300 lei netaxabili (salariu minim)</span>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{fmtRON(result.relief300)}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{fmtEUR(result.relief300)}</div>
          </div>
        </div>
      )}
    </div>

    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      *Sumele de mai sus nu se impozitează; reduc baza impozabilă și, după caz, baza CAS/CASS.
    </p>
  </div>
)}

</div>

      
            
      {/* ===== Zona 3: Bara de procente (Angajat vs Stat) */}
<div className="lg:col-span-12 mt-2 p-4 rounded-xl bg-white/90 border border-slate-200 shadow-sm dark:bg-slate-800/80 dark:border-slate-700">
  <h4 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-3">
    Repartizare procentaj (Angajat vs Stat)
  </h4>

  {(() => {
    const total = result.EMPLOYER_COST || 1;
    const angajat = result.NET || 0;
    const stat = total - angajat;
    const pAngajat = (angajat / total) * 100;
    const pStat = (stat / total) * 100;
    const sum = pAngajat + pStat || 1;
    const wAngajat = (pAngajat / sum) * 100;
    const wStat = (pStat / sum) * 100;

    return (
      <>
        <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
          <div
            className="h-full bg-slate-700 transition-all duration-500"
            style={{ width: `${wAngajat}%` }}
            title={`Angajat ${pAngajat.toFixed(1)}%`}
          />
          <div
            className="h-full bg-amber-500 transition-all duration-500"
            style={{ width: `${wStat}%` }}
            title={`Stat ${pStat.toFixed(1)}%`}
          />
        </div>

        <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300 mt-2">
          <span>Angajat: {pAngajat.toFixed(1)}%</span>
          <span>Stat: {pStat.toFixed(1)}%</span>
        </div>
      </>
    );
  })()}
</div>


    </div>
  );
  
}


function InfoCard() {
  return (
    <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:bg-slate-800/80 dark:border-slate-700
">
      <h3 className="text-lg font-semibold mb-2 text-slate-700 dark:text-slate-200">Cum funcționează</h3>
      <ul className="list-disc list-inside text-sm text-slate-700  dark:text-slate-200 space-y-1">
        <li>Introduceți salariul <strong>brut</strong> sau <strong>net dorit</strong> și (opțional) deducerea personală.</li>
        <li>Contribuțiile și taxele se calculează instant, cu defalcare clară.</li>
        <li>Procentele (CAS/CASS/Impozit/CAM) pot fi modificate din <em>Setări</em>.</li>
        <li>Design responsiv: impecabil pe desktop și mobil.</li>
      </ul>
      <details className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium">Limitări & extensii posibile</summary>
        <div className="mt-2 space-y-2">
          <p>Nu include toate scutirile (IT/construcții etc.). Se pot adăuga opțiuni dedicate.</p>
          <p>Deducere personală automată pe grile oficiale – se poate integra.</p>
          <p>Export PDF/CSV și link partajabil – opțional.</p>
        </div>
      </details>
    </div>
  );
}
function GuideCard() {
  return (
    <div className="p-5 rounded-2xl bg-white/90 border border-indigo-100 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:bg-slate-800/80 dark:border-slate-700">
      <h3 className="text-lg font-semibold mb-2 text-slate-700 dark:text-slate-200">Explicații contribuții</h3>
<ul className="list-disc list-inside text-sm text-slate-700 dark:text-slate-200 space-y-1">
  <li><strong>CAS (25%)</strong> –contribuția la pensie, plătită de angajat.
Ajută la formarea pensiei de stat (Pilon I).</li>
  <li><strong>CASS (10%)</strong> – contribuția la sănătate, plătită tot de angajat.
Asigură accesul la serviciile medicale din sistemul public.</li>
  <li><strong>Impozit (10%)</strong> – se aplică după ce se scad contribuțiile și deducerea personală.
Practic, e „taxa pe salariul rămas”.</li>
  <li><strong>CAM (2.25%)</strong> – contribuție plătită de angajator, pentru fonduri sociale (șomaj, accidente etc.).</li>
  <li><strong>Deducere personală</strong> – o reducere de impozit acordată automat angajaților cu venituri mici, în funcție de salariu și numărul de persoane aflate în întreținere.</li>
</ul>


      <h3 className="text-lg font-semibold mt-4 mb-2 text-slate-700 dark:text-slate-200">Ghid de utilizare</h3>
      <ul className="list-disc list-inside text-sm text-slate-700 dark:text-slate-200 space-y-1">
        <li>Introduceți salariul brut (sau netul dorit, schimbând direcția de calcul).</li>
        <li>Selectați numărul de persoane în întreținere (influentează deducerea).</li>
        <li>Calculatorul aplică automat legislația 2025 (inclusiv 300 lei netaxabili).</li>
        <li>Rezultatele se actualizează instant, fără buton de „Calculează”.</li>
      </ul>
    </div>
  );
}
function WorkingDaysPage({
  onBack,
  defaultYear = new Date().getFullYear(),
}: {
  onBack: () => void;
  defaultYear?: number;
}) {
  const [year, setYear] = React.useState<number>(defaultYear);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const roHolidays = React.useMemo(() => getRomanianHolidaysWithNames(year), [year]);
  const holidaySet = React.useMemo(() => new Set(roHolidays.map(h => h.date)), [roHolidays]);
  const months = React.useMemo(() => getWorkingDaysByMonth(year, holidaySet), [year, holidaySet]);

  const holidaysByMonth = React.useMemo(() => {
    const map: Record<number, { date: string; name: string }[]> = {};
    for (let m = 0; m < 12; m++) map[m] = [];
    for (const h of roHolidays) {
      const mm = Number(h.date.slice(5, 7)) - 1;
      map[mm].push(h);
    }
    return map;
  }, [roHolidays]);

  const roMonth = (m: number) =>
    ["Ianuarie","Februarie","Martie","Aprilie","Mai","Iunie","Iulie","August","Septembrie","Octombrie","Noiembrie","Decembrie"][m];

  const totalWork = months.reduce((s, x) => s + x.work, 0);
  const totalHours8 = totalWork * 8;
  const totalHours7 = totalWork * 7;

  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 dark:text-slate-100 dark:from-slate-900 dark:to-slate-950">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-indigo-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:bg-slate-900/70 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-800 dark:text-slate-100">Zile lucratoare</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">Calendar anual cu sarbatori RO</p>
          </div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:border-slate-400 transition dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
          >
            ↩ Inapoi
          </button>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-7xl mx-auto px-4 py-6 grid gap-4 lg:grid-cols-12">
          <section className="lg:col-span-8 p-4 rounded-xl bg-white/95 border border-slate-200 shadow-sm dark:bg-slate-900/70 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Zile lucratoare pe luni – {year}</h2>
              <span className="text-sm text-slate-500 dark:text-slate-300">Total anual: {totalWork} zile</span>
            </div>

            <table className="table-fixed w-full text-sm border-separate border-spacing-y-1 tabular-nums">
              <colgroup>
                <col style={{ width: "32%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left pl-2.5 py-1.5">Luna</th>
                  <th className="text-right px-2.5 py-1.5">Zile calendaristice</th>
                  <th className="text-right pr-2.5 py-1.5">Zile lucratoare</th>
                  <th className="text-right pr-2.5 py-1.5">Ore (8h)</th>
                  <th className="text-right pr-2.5 py-1.5">Ore (7h)</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <React.Fragment key={i}>
                    <tr
                      className="transition border border-slate-200 rounded-lg shadow-sm bg-white/90 hover:bg-slate-50 cursor-pointer dark:bg-slate-800/80 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      title="Click pentru a vedea sarbatorile din luna"
                    >
                      <td className="px-2.5 py-1.5 rounded-l-xl flex items-center gap-2">
                        <span className="inline-block w-5 text-center">{expanded === i ? "−" : "+"}</span>
                        <span>{roMonth(m.month)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right">{m.total}</td>
                      <td className="px-2.5 py-1.5 text-right font-medium">{m.work}</td>
                      <td className="px-2.5 py-1.5 text-right">{m.work * 8}</td>
                      <td className="px-2.5 py-1.5 text-right rounded-r-xl">{m.work * 7}</td>
                    </tr>

                    {expanded === i && (
                      <tr>
                        <td colSpan={5} className="px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg dark:bg-slate-900/40 dark:border-slate-800">
                          {holidaysByMonth[i].length === 0 ? (
                            <div className="text-sm text-slate-500 dark:text-slate-400">Nu sunt sarbatori legale in aceasta luna.</div>
                          ) : (
                            <div className="text-sm">
                              <div className="font-medium text-slate-700 dark:text-slate-200 mb-2">Sarbatori legale in {roMonth(i)}:</div>
                              <ul className="grid gap-1">
                                {holidaysByMonth[i]
                                  .sort((a, b) => a.date.localeCompare(b.date))
                                  .map((h) => (
                                    <li key={h.date} className="flex items-center justify-between bg-white/80 border border-slate-200 rounded-lg px-3 py-2 dark:bg-slate-800/80 dark:border-slate-700">
                                      <span className="text-slate-700 dark:text-slate-200">{h.name}</span>
                                      <span className="text-slate-600 dark:text-slate-300 tabular-nums">{h.date}</span>
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800 text-white rounded-lg dark:bg-slate-700">
                  <td className="px-2.5 py-2 rounded-l-xl font-semibold">Total</td>
                  <td className="px-2.5 py-2 text-right">{months.reduce((s, x) => s + x.total, 0)}</td>
                  <td className="px-2.5 py-2 text-right font-semibold">{totalWork}</td>
                  <td className="px-2.5 py-2 text-right font-semibold">{totalHours8}</td>
                  <td className="px-2.5 py-2 text-right rounded-r-xl font-semibold">{totalHours7}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <aside className="lg:col-span-4 grid gap-4">
            <div className="p-4 rounded-xl bg-white/95 border border-slate-200 shadow-sm dark:bg-slate-900/70 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">Anul</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setYear((y) => y - 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
                >
                  −
                </button>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-28 text-center rounded-lg border border-slate-300 px-2 py-1.5 bg-white/60 dark:bg-slate-900/40 dark:border-slate-700"
                />
                <button
                  onClick={() => setYear((y) => y + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:border-slate-500"
                >
                  +
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-300 mt-2">
                Calculul exclude automat sambata, duminica si sarbatorile legale RO.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <footer className="mt-auto border-t border-indigo-100 bg-white/60 backdrop-blur-sm dark:bg-slate-900/70 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-4 text-sm text-slate-600 dark:text-slate-300 text-center">
          Calcul rapid al zilelor lucratoare – {year}
        </div>
      </footer>
    </div>
  );
}
function getWorkingDaysByMonth(year: number, holidays: Set<string>) {
  const out: { month: number; total: number; work: number }[] = [];
  for (let m = 0; m < 12; m++) {
    let total = 0;
    let work = 0;
    const d = new Date(year, m, 1);
    while (d.getMonth() === m) {
      total++;
      const dow = d.getDay(); // 0=Sun .. 6=Sat
      const iso = ymd(d);
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidays.has(iso);
      if (!isWeekend && !isHoliday) work++;
      d.setDate(d.getDate() + 1);
    }
    out.push({ month: m, total, work });
  }
  return out;
}


function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 dark:text-slate-100 dark:from-slate-900 dark:to-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-indigo-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:bg-slate-800/80 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-semibold dark:text-slate-100">Despre acest proiect</h1>
          <button
            onClick={onBack}
            className="rounded-xl bg-slate-700 text-white px-4 py-2 shadow-sm hover:bg-slate-800 transition"
          >
            ← Înapoi
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 grid gap-8 lg:grid-cols-2">
        {/* Partea 1 – despre proiect */}
        <section className="bg-white p-6 rounded-2xl shadow border border-slate-200 dark:bg-slate-800/80 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-3 text-slate-800 dark:text-slate-100">Scopul proiectului</h2>
          <p className="text-slate-700 dark:text-slate-200 leading-relaxed text-sm">
            Acest calculator de salarii a fost creat pentru a oferi o alternativă
            modernă, clară și ușor de folosit pentru oricine vrea să înțeleagă cum
            se formează salariul net și costurile reale pentru angajator.
          </p>
          <p className="text-slate-700 dark:text-slate-200 leading-relaxed text-sm mt-3">
            Ideea din spatele proiectului este de a ajuta oamenii să devină mai
            conștienți de deduceri, contribuții și impozite — și astfel să aibă o
            imagine mai clară asupra veniturilor reale și a sistemului fiscal.
          </p>
        </section>

        {/* Partea 2 – explicații simple */}
        <section className="bg-white p-6 rounded-2xl shadow border border-slate-200 dark:bg-slate-800/80 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-3 text-slate-800 dark:text-slate-100 ">Explicații pe scurt</h2>
          <ul className="list-disc list-inside space-y-2 text-slate-700 dark:text-slate-200 text-sm leading-relaxed">
            <li><strong>CAS (25%)</strong> – contribuția la pensie, plătită de angajat.</li>
            <li><strong>CASS (10%)</strong> – contribuția la sănătate, plătită de angajat.</li>
            <li><strong>Impozitul pe venit (10%)</strong> – se aplică pe baza impozabilă, după deduceri.</li>
            <li><strong>CAM (2.25%)</strong> – contribuția plătită de angajator pentru asigurări sociale.</li>
            <li><strong>Deducerea personală</strong> – reduce impozitul pentru veniturile mai mici, în funcție de persoane în întreținere.</li>
          </ul>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
            *Valorile și regulile sunt bazate pe legislația 2025. Pentru cazuri speciale
            (IT, construcții, agricultură) se pot adăuga opțiuni dedicate în viitor.
          </p>
        </section>
      </main>

      <footer className="mt-auto border-t border-indigo-100 bg-white/60 backdrop-blur-sm dark:bg-slate-800/80 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-slate-600 dark:text-slate-300 text-center">
          © {new Date().getFullYear()} Calculator salarii – Proiect educativ, non-comercial.
        </div>
      </footer>
    </div>
  );
}
