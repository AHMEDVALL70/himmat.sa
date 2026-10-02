#!/usr/bin/env node
/**
 * scripts/generate-district-pages.js
 * ============================================================================
 * صفحات الأحياء (2026-10-02) — شقيق generate-offer-pages.js / generate-section-pages.js.
 *
 * كل حي مسعَّر (5 صفقات فأكثر خلال آخر 12 شهراً من بيانات وزارة العدل المفتوحة)
 * يأخذ صفحة HTML مستقلة حقيقية على مسار عربي:
 *     /أحياء/<المدينة-بشرطات>/<الحي-بشرطات>/
 * الصفحة نصية بالكامل (مو نسخة من index.html): سعر المتر، عدد الصفقات، مقارنة
 * بمتوسط المدينة، الترتيب، أحياء قريبة بالسعر، وزر إلى المؤشر. صفر جافاسكربت
 * مطلوب لعرض المحتوى (يقرأه أي بوت مباشرة).
 *
 * الاستخدام:
 *   node scripts/generate-district-pages.js --pilot            # حي واحد (قباء/المدينة المنورة) من ملف محلي
 *   node scripts/generate-district-pages.js --from-file f.json # كل الأحياء من ملف JSON
 * (الاتصال بـSupabase داخل الـAction يُضاف بعد نجاح التجربة على GitHub Pages.)
 *
 * صيغة الملف: [{city, district, price, deals, upd}] — price = وسيط سعر المتر.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_ORIGIN = "https://himmat.sa";
const OUT_DIR_NAME = "أحياء";
const MIN_DEALS = 5;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Math.round(n).toLocaleString("en-US");
const slug = (s) => String(s).trim().replace(/\s+/g, "-");
const pagePath = (r) => `/${OUT_DIR_NAME}/${slug(r.city)}/${slug(r.district)}/`;
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function median(arr) {
  const a = [...arr].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** يرجّع الأحياء المؤهَّلة للنشر + مقاييس كل مدينة */
function prepare(rows) {
  const eligible = rows.filter((r) => r.price > 0 && r.deals >= MIN_DEALS);
  const seen = new Map();
  for (const r of eligible) {
    const p = pagePath(r);
    if (seen.has(p)) throw new Error(`تعارض مسارين على نفس الرابط: ${p}`);
    seen.set(p, r);
  }
  const byCity = {};
  eligible.forEach((r) => (byCity[r.city] = byCity[r.city] || []).push(r));
  return { eligible, byCity };
}

function render(r, ctx) {
  const list = ctx.byCity[r.city];
  const cityMedian = median(list.map((x) => x.price));
  const sorted = [...list].sort((a, b) => b.price - a.price);
  const rank = sorted.findIndex((x) => x === r) + 1;
  const diff = Math.round(((r.price - cityMedian) / cityMedian) * 100);
  const diffText = diff === 0 ? "مطابق لمتوسط المدينة" : diff > 0 ? `أعلى من متوسط المدينة بحوالي ${Math.abs(diff)}%` : `أقل من متوسط المدينة بحوالي ${Math.abs(diff)}%`;
  const near = list.filter((x) => x !== r).sort((a, b) => Math.abs(a.price - r.price) - Math.abs(b.price - r.price)).slice(0, 4);
  const url = SITE_ORIGIN + encPath(pagePath(r));
  const valUrl = `/valuation?city=${encodeURIComponent(r.city)}&district=${encodeURIComponent(r.district)}`;
  const title = `سعر المتر في حي ${r.district} — ${r.city} | همة المدينة العقارية`;
  const desc = `وسيط سعر المتر في حي ${r.district} بـ${r.city}: ${num(r.price)} ريال، من ${r.deals} صفقة موثّقة خلال آخر 12 شهراً (وزارة العدل). مقارنة بالأحياء القريبة وتقدير مجاني لعقارك.`;
  const updated = r.upd ? String(r.upd).slice(0, 10) : "";
  const nearHtml = near.map((x) => {
    const link = ctx.hasPage(x) ? `<a href="${esc(encPath(pagePath(x)))}">${esc(x.district)}</a>` : esc(x.district);
    return `<li>${link} — <b>${num(x.price)}</b> ريال/م²</li>`;
  }).join("");
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: r.city },
      { "@type": "ListItem", position: 3, name: `حي ${r.district}`, item: url },
    ],
  };
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE_ORIGIN}/Himmat-Almedina.png">
<meta property="og:locale" content="ar_SA">
<link rel="icon" href="/icons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">
<link rel="manifest" href="/site.webmanifest">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script>try{var t=localStorage.getItem('himmat-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;900&family=Almarai:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css?v=20260925b">
<style>
.dp{padding-block:36px 56px}.dp h1{font-size:30px;margin:6px 0 4px}.dp .crumbs{font-size:13px;opacity:.75}
.dp .crumbs a{text-decoration:underline}.dp .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:22px 0}
.dp .kpi{padding:18px}.dp .kpi b{display:block;font-size:26px;color:var(--gold-500);font-family:var(--font-display)}
.dp .kpi span{font-size:13px;opacity:.8}.dp section{margin:26px 0}.dp h2{font-size:20px;margin:0 0 10px}
.dp ul{padding-inline-start:20px;line-height:2}.dp .src{font-size:12.5px;opacity:.75;line-height:1.8}
.dp .card:hover{transform:none;box-shadow:var(--shadow)}
.dp-top{display:flex;align-items:center;gap:12px;padding-block:14px;flex-wrap:wrap}.dp-top a{font-weight:700}
</style>
</head>
<body>
<header class="site"><div class="container dp-top">
  <a href="/" class="brand"><span>همة المدينة العقارية</span></a>
  <nav class="links" style="margin-inline-start:auto;display:flex;gap:16px">
    <a href="/valuation">المؤشر</a><a href="/offers">العروض</a><a href="/services">الخدمات</a><a href="/contact">تواصل</a>
  </nav>
</div></header>
<main class="container dp">
  <div class="crumbs"><a href="/">الرئيسية</a> › ${esc(r.city)} › حي ${esc(r.district)}</div>
  <h1>سعر المتر في حي ${esc(r.district)} — ${esc(r.city)}</h1>
  <p>${esc(diffText)}. بيانات مبنية على صفقات موثّقة فعلاً، مو أسعار عرض.</p>
  <div class="kpis">
    <div class="card kpi"><b>${num(r.price)} ريال</b><span>وسيط سعر المتر المربع</span></div>
    <div class="card kpi"><b>${r.deals}</b><span>صفقة موثّقة خلال آخر 12 شهراً</span></div>
    <div class="card kpi"><b>${num(cityMedian)} ريال</b><span>وسيط ${esc(r.city)} (الأحياء المسعّرة)</span></div>
    <div class="card kpi"><b>${rank} من ${sorted.length}</b><span>الترتيب بين أحياء ${esc(r.city)} (1 = الأعلى سعراً)</span></div>
  </div>
  <section class="card" style="padding:20px">
    <h2>أحياء قريبة بالسعر في ${esc(r.city)}</h2>
    <ul>${nearHtml}</ul>
  </section>
  <section class="card" style="padding:20px">
    <h2>كم قيمة عقارك في حي ${esc(r.district)}؟</h2>
    <p>أدخل المساحة ونوع العقار واحصل على تقدير مجاني بصيغة شفافة مبنية على نفس هذه الأسعار.</p>
    <a class="btn btn-primary" href="${esc(valUrl)}">احسب تقدير عقارك</a>
  </section>
  <p class="src">المصدر: وزارة العدل — البيانات المفتوحة${updated ? ` (آخر تحديث لقاعدة الأسعار: ${esc(updated)})` : ""}. السعر وسيط الصفقات الموثّقة وقد يختلف عن السعر الحالي الفعلي في الأحياء المتصاعدة بسرعة؛ المعلومات للاطلاع العام وليست تقييماً رسمياً ولا نصيحة استثمارية. همة المدينة العقارية — رخصة فال: 1200030428.</p>
</main>
<footer class="site"><div class="container" style="padding-block:18px;font-size:13px">© همة المدينة العقارية — <a href="/privacy">الخصوصية</a> · <a href="/terms">الشروط</a></div></footer>
</body>
</html>
`;
}

function run(rows, pilotOnly) {
  const ctx0 = prepare(rows);
  const pages = new Set(ctx0.eligible);
  const ctx = { ...ctx0, hasPage: (x) => pages.has(x) };
  let targets = ctx0.eligible;
  if (pilotOnly) {
    targets = ctx0.eligible.filter((r) => r.city === "المدينة المنورة" && r.district === "قباء");
    pages.clear(); targets.forEach((t) => pages.add(t));
  }
  for (const r of targets) {
    const dir = path.join(ROOT, ...pagePath(r).split("/").filter(Boolean));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), render(r, ctx));
  }
  return targets;
}

module.exports = { prepare, render, pagePath, encPath, run, MIN_DEALS };

if (require.main === module) {
  const a = process.argv.slice(2);
  const file = a.includes("--pilot") ? path.join(__dirname, "district-prices-sample.json") : a[a.indexOf("--from-file") + 1];
  if (!file || !fs.existsSync(file)) { console.error("حدد --pilot أو --from-file <ملف>"); process.exit(2); }
  const out = run(JSON.parse(fs.readFileSync(file, "utf8")), a.includes("--pilot"));
  console.log(`وُلّدت ${out.length} صفحة`);
}
