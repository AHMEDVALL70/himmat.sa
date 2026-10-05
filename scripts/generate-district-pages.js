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
 *   node scripts/generate-district-pages.js                     # الإنتاج: يقرأ Supabase (مفتاح anon، قراءة فقط) — داخل الـAction
 *   node scripts/generate-district-pages.js --from-file f.json  # من ملف JSON محلي (اختبار)
 *   node scripts/generate-district-pages.js --pilot             # مثل --from-file لكن من العيّنة المحفوظة scripts/district-prices-sample.json
 *
 * يولّد أيضاً: صفحة لكل مدينة (/أحياء/<المدينة>/) + صفحة رئيسية (/أحياء/)
 * + sitemap-districts.xml. أمان: لو عدد الأحياء المؤهَّلة أقل بكثير من المتوقع
 * أو من التشغيلة السابقة (قاعدة فاضية/عطل) يتوقف بدون كتابة أو حذف أي ملف.
 *
 * صيغة الملف المحلي: [{city, district, price, deals, upd}] — price = وسيط سعر المتر.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_ORIGIN = "https://himmat.sa";
const OUT_DIR_NAME = "أحياء";
const MIN_DEALS = 5;
const SUPABASE_URL = "https://wlebcvwsleoieodjtrcf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KhUpsOF0OxVQWyWLakXx2g_yDsUlnxV";
const OUT_DIR = path.join(ROOT, OUT_DIR_NAME);
const MANIFEST_PATH = path.join(OUT_DIR, ".manifest.json");
const SITEMAP_PATH = path.join(ROOT, "sitemap-districts.xml");
const MIN_EXPECTED = 300;      // أقل عدد معقول من الأحياء المؤهَّلة (الفعلي 569)
const MIN_RATIO_PREV = 0.7;    // أقل نسبة مقبولة من عدد التشغيلة السابقة

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

const CITY_PATH = (city) => `/${OUT_DIR_NAME}/${slug(city)}/`;

function shell({ title, desc, canonical, ld, main }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE_ORIGIN}/Himmat-Almedina.png">
<meta property="og:locale" content="ar_SA">
<link rel="icon" href="/icons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">
<link rel="manifest" href="/site.webmanifest">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script>try{var t=localStorage.getItem('himmat-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<link rel="preload" as="image" href="/assets/images/hero-madinah-800.webp" fetchpriority="high" media="(max-width:820px)">
<link rel="preload" as="image" href="/assets/images/hero-madinah-1600.webp" fetchpriority="high" media="(min-width:821px)">
<link rel="preload" href="/assets/fonts/almarai-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/almarai-arabic-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/almarai-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/almarai-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/tajawal-arabic-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/tajawal-arabic-900-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/tajawal-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/tajawal-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=20261005b">
<style>
.dp{padding-block:36px 56px}.dp h1{font-size:30px;margin:6px 0 4px}.dp .crumbs{font-size:13px;opacity:.75;margin-bottom:6px}
.dp .crumbs a{text-decoration:underline}.dp .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:22px 0}
.dp .kpi{padding:18px}.dp .kpi b{display:block;font-size:26px;color:var(--gold-500);font-family:var(--font-display)}
.dp .kpi span{font-size:13px;opacity:.8}.dp section{margin:26px 0}.dp h2{font-size:20px;margin:0 0 10px}
.dp ul{padding-inline-start:20px;line-height:2}.dp .src{font-size:12.5px;opacity:.75;line-height:1.8}
.dp .card:hover{transform:none;box-shadow:var(--shadow)}
.dp .dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 18px;list-style:none;padding:0}
.dp .dgrid li{padding:8px 0;border-bottom:1px solid var(--line)}
.dp-top{display:flex;align-items:center;gap:12px;padding-block:14px;flex-wrap:wrap}.dp-top a{font-weight:700}
</style>
</head>
<body>
<header class="site"><div class="container dp-top">
  <a href="/" class="brand"><span>همة المدينة العقارية</span></a>
  <nav class="links" style="margin-inline-start:auto;display:flex;gap:16px">
    <a href="/valuation">المؤشر</a><a href="/offers">العروض</a><a href="/${OUT_DIR_NAME}/">أسعار الأحياء</a><a href="/services">الخدمات</a><a href="/contact">تواصل</a>
  </nav>
</div></header>
<main class="container dp">
${main}
</main>
<footer class="site"><div class="container" style="padding-block:18px;font-size:13px">© همة المدينة العقارية — <a href="/privacy">الخصوصية</a> · <a href="/terms">الشروط</a></div></footer>
</body>
</html>
`;
}

const SRC_NOTE = (updated) => `المصدر: وزارة العدل — البيانات المفتوحة${updated ? ` (آخر تحديث لقاعدة الأسعار: ${esc(updated)})` : ""}. السعر وسيط الصفقات الموثّقة وقد يختلف عن السعر الحالي الفعلي في الأحياء المتصاعدة بسرعة؛ المعلومات للاطلاع العام وليست تقييماً رسمياً ولا نصيحة استثمارية. همة المدينة العقارية — رخصة فال: 1200030428.`;

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
  const offers = (ctx.offers || []).filter((o) => o.city === r.city && o.district === r.district).slice(0, 6);
  const offersHtml = offers.length
    ? `<section class="card" style="padding:20px"><h2>عروض متاحة في حي ${esc(r.district)}</h2><ul>${offers.map((o) =>
        `<li><a href="/offer/${esc(o.id)}/">${esc(o.title)}</a>${o.price_final ? ` — <b>${num(o.price_final)}</b> ريال` : ""}</li>`).join("")}</ul></section>`
    : `<section class="card" style="padding:20px"><h2>عروض حي ${esc(r.district)}</h2><p>ما فيه عروض منشورة في هذا الحي حالياً. عندك عقار فيه؟ <a href="/add-property" style="text-decoration:underline">أضفه مجاناً</a>، أو <a href="/offers" style="text-decoration:underline">تصفّح كل العروض</a>.</p></section>`;
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: `أسعار الأحياء`, item: SITE_ORIGIN + encPath(`/${OUT_DIR_NAME}/`) },
      { "@type": "ListItem", position: 3, name: r.city, item: SITE_ORIGIN + encPath(CITY_PATH(r.city)) },
      { "@type": "ListItem", position: 4, name: `حي ${r.district}`, item: url },
    ],
  };
  const main = `  <div class="crumbs"><a href="/">الرئيسية</a> › <a href="${esc(encPath(`/${OUT_DIR_NAME}/`))}">أسعار الأحياء</a> › <a href="${esc(encPath(CITY_PATH(r.city)))}">${esc(r.city)}</a> › حي ${esc(r.district)}</div>
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
  ${offersHtml}
  <section class="card" style="padding:20px">
    <h2>كم قيمة عقارك في حي ${esc(r.district)}؟</h2>
    <p>أدخل المساحة ونوع العقار واحصل على تقدير مجاني بصيغة شفافة مبنية على نفس هذه الأسعار.</p>
    <a class="btn btn-primary" href="${esc(valUrl)}">احسب تقدير عقارك</a>
  </section>
  <p class="src">${SRC_NOTE(updated)}</p>`;
  return shell({ title, desc, canonical: url, ld, main });
}

function renderCity(city, ctx) {
  const list = [...ctx.byCity[city]].sort((a, b) => b.price - a.price);
  const url = SITE_ORIGIN + encPath(CITY_PATH(city));
  const med = median(list.map((x) => x.price));
  const title = `أسعار الأحياء في ${city} — سعر المتر لكل حي | همة المدينة العقارية`;
  const desc = `سعر المتر المربع في ${list.length} حياً بـ${city} من صفقات موثّقة لوزارة العدل. وسيط المدينة ${num(med)} ريال/م².`;
  const updated = list.map((x) => String(x.upd || "").slice(0, 10)).sort().pop() || "";
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_ORIGIN + "/" },
    { "@type": "ListItem", position: 2, name: "أسعار الأحياء", item: SITE_ORIGIN + encPath(`/${OUT_DIR_NAME}/`) },
    { "@type": "ListItem", position: 3, name: city, item: url } ] };
  const main = `  <div class="crumbs"><a href="/">الرئيسية</a> › <a href="${esc(encPath(`/${OUT_DIR_NAME}/`))}">أسعار الأحياء</a> › ${esc(city)}</div>
  <h1>أسعار الأحياء في ${esc(city)}</h1>
  <p>${list.length} حياً مسعّراً من صفقات موثّقة (5 صفقات فأكثر خلال آخر 12 شهراً). وسيط المدينة: <b>${num(med)}</b> ريال/م². مرتبة من الأعلى سعراً.</p>
  <section class="card" style="padding:20px"><ul class="dgrid">${list.map((x) =>
    `<li><a href="${esc(encPath(pagePath(x)))}">${esc(x.district)}</a> — <b>${num(x.price)}</b> ريال/م²</li>`).join("")}</ul></section>
  <p class="src">${SRC_NOTE(updated)}</p>`;
  return shell({ title, desc, canonical: url, ld, main });
}

function renderHub(ctx) {
  const url = SITE_ORIGIN + encPath(`/${OUT_DIR_NAME}/`);
  const cities = Object.keys(ctx.byCity).sort((a, b) => ctx.byCity[b].length - ctx.byCity[a].length);
  const total = cities.reduce((n, c) => n + ctx.byCity[c].length, 0);
  const title = "أسعار الأحياء العقارية — سعر المتر في المدينة المنورة ومكة وجدة والرياض | همة المدينة العقارية";
  const desc = `سعر المتر المربع في ${total} حياً بأربع مدن، من صفقات موثّقة لوزارة العدل — مع مقارنة بمتوسط المدينة وتقدير مجاني لعقارك.`;
  const updated = Object.values(ctx.byCity).flat().map((x) => String(x.upd || "").slice(0, 10)).sort().pop() || "";
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_ORIGIN + "/" },
    { "@type": "ListItem", position: 2, name: "أسعار الأحياء", item: url } ] };
  const main = `  <div class="crumbs"><a href="/">الرئيسية</a> › أسعار الأحياء</div>
  <h1>أسعار الأحياء العقارية</h1>
  <p>سعر المتر المربع في ${total} حياً، مبني على صفقات موثّقة فعلاً من وزارة العدل. اختر مدينتك:</p>
  <div class="kpis">${cities.map((c) => `<a class="card kpi" href="${esc(encPath(CITY_PATH(c)))}"><b>${esc(c)}</b><span>${ctx.byCity[c].length} حياً — الوسيط ${num(median(ctx.byCity[c].map((x) => x.price)))} ريال/م²</span></a>`).join("")}</div>
  <p class="src">${SRC_NOTE(updated)}</p>`;
  return shell({ title, desc, canonical: url, ld, main });
}

function buildSitemap(entries) {
  const urls = entries.map((e) => `  <url>\n    <loc>${SITE_ORIGIN}${encPath(e.p)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}\n    <changefreq>weekly</changefreq>\n    <priority>${e.pr}</priority>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** كل الملفات المطلوب كتابتها: { rel: مسار الملف نسبةً للجذر, html } + مدخلات الخريطة */
function buildAll(rows, offers) {
  const ctx0 = prepare(rows);
  const pages = new Set(ctx0.eligible);
  const ctx = { ...ctx0, offers: offers || [], hasPage: (x) => pages.has(x) };
  const files = [];
  const entries = [{ p: `/${OUT_DIR_NAME}/`, pr: "0.7", lastmod: "" }];
  files.push({ dir: `/${OUT_DIR_NAME}/`, html: renderHub(ctx) });
  for (const city of Object.keys(ctx.byCity)) {
    files.push({ dir: CITY_PATH(city), html: renderCity(city, ctx) });
    entries.push({ p: CITY_PATH(city), pr: "0.7", lastmod: ctx.byCity[city].map((x) => String(x.upd || "").slice(0, 10)).sort().pop() || "" });
  }
  for (const r of ctx0.eligible) {
    files.push({ dir: pagePath(r), html: render(r, ctx) });
    entries.push({ p: pagePath(r), pr: "0.6", lastmod: String(r.upd || "").slice(0, 10) });
  }
  return { files, entries, count: ctx0.eligible.length };
}

async function supaSelect(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!res.ok) throw new Error(`فشل جلب ${table}: ${res.status} ${await res.text().catch(() => "")}`);
    const part = await res.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}

async function fetchFromSupabase() {
  const dp = await supaSelect("district_prices", "select=price_per_sqm,transaction_count,updated_at,districts(name,cities(name))&order=district_id");
  const rows = dp.filter((r) => r.districts && r.districts.cities).map((r) => ({
    city: r.districts.cities.name, district: r.districts.name,
    price: Number(r.price_per_sqm), deals: Number(r.transaction_count || 0), upd: r.updated_at,
  }));
  const offers = await supaSelect("offers", "select=id,title,city,district,price_final&is_published=eq.true&deleted_at=is.null&order=created_at.desc");
  return { rows, offers };
}

function writeAll(built) {
  const prev = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) : [];
  if (prev.length && built.files.length < prev.length * MIN_RATIO_PREV)
    throw new Error(`عدد الصفحات ${built.files.length} أقل بكثير من السابق ${prev.length} — توقف بدون كتابة/حذف`);
  if (built.count < MIN_EXPECTED) throw new Error(`عدد الأحياء المؤهَّلة ${built.count} أقل من الحد الأدنى ${MIN_EXPECTED} — توقف بدون كتابة/حذف`);
  const now = built.files.map((f) => f.dir);
  for (const f of built.files) {
    const dir = path.join(ROOT, ...f.dir.split("/").filter(Boolean));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), f.html, "utf8");
  }
  const removed = prev.filter((d) => !now.includes(d));
  for (const d of removed) {
    const dir = path.join(ROOT, ...d.split("/").filter(Boolean));
    if (fs.existsSync(dir) && dir.startsWith(OUT_DIR)) fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(now, null, 1), "utf8");
  fs.writeFileSync(SITEMAP_PATH, buildSitemap(built.entries), "utf8");
  return removed.length;
}

module.exports = { writeAll, prepare, render, renderCity, renderHub, buildAll, buildSitemap, pagePath, encPath, MIN_DEALS };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2);
    let rows, offers = [];
    if (a.includes("--pilot")) rows = JSON.parse(fs.readFileSync(path.join(__dirname, "district-prices-sample.json"), "utf8"));
    else if (a.includes("--from-file")) rows = JSON.parse(fs.readFileSync(a[a.indexOf("--from-file") + 1], "utf8"));
    else ({ rows, offers } = await fetchFromSupabase());
    const built = buildAll(rows, offers);
    const removed = writeAll(built);
    console.log(`وُلّدت ${built.files.length} صفحة (${built.count} حي) وحُذفت ${removed} قديمة.`);
  })().catch((e) => { console.error("فشل توليد صفحات الأحياء:", e.message); process.exit(1); });
}
