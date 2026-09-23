#!/usr/bin/env node
/**
 * scripts/generate-offer-pages.js
 * ============================================================================
 * المستوى الثاني من إصلاح السيو (2026-09-23) — شقيق generate-snapshot.js،
 * نفس نمط القراءة من Supabase (مفتاح anon العام، قراءة فقط، صفر صلاحية كتابة
 * على قاعدة البيانات).
 *
 * الهدف: أدوات ما تشغّل جافاسكربت (معاينة روابط واتساب/تويتر تحديداً) تحتاج
 * ترى وسوم <title>/og:* مخصَّصة لكل عرض بالاستجابة الأولى نفسها — المستوى
 * الأول (مسارات /offers الحقيقية عبر 404.html) ما يكفي لهذا تحديداً لأنه
 * يعتمد على تحويل جافاسكربت. الحل هنا: توليد مجلد+ملف index.html **حقيقي
 * فعلي** لكل عرض منشور (offer/<id>/index.html) — مو عبر 404.html، ملف
 * موجود فعلاً فيقرأه أي بوت مباشرة بدون أي تحويل.
 *
 * كل صفحة مولَّدة = نفس هيكل index.html الرئيسي بالضبط، بس وسوم العنوان/
 * الوصف/og:image مستبدَلة ببيانات ذاك العرض بالذات. لما تشتغل الجافاسكربت
 * (لزائر حقيقي أو Google، اللي يشغّل جافاسكربت فعلياً)، site.js يتعرّف على
 * نمط /offer/<id>/ بالمسار (راجع handleDeepLinkOffer بـjs/site.js) ويفتح
 * تفاصيل العرض تلقائياً — نفس تطبيق الموقع العادي بالضبط، صفر ازدواجية منطق.
 *
 * تنظيف تلقائي: offer/.manifest.json يحفظ قائمة الأحياء [كذا: العروض]
 * المولَّدة آخر تشغيلة. أي عرض اختفى (حُذف أو أُلغي نشره) من القائمة
 * الحالية يُحذف مجلده تلقائياً — يمنع بقاء صفحات "ميتة" مفهرَسة بجوجل.
 *
 * يشتغل ضمن نفس GitHub Action اليومي الموجود
 * (.github/workflows/generate-snapshot.yml)، كخطوة إضافية.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://wlebcvwsleoieodjtrcf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KhUpsOF0OxVQWyWLakXx2g_yDsUlnxV";
const ROOT = path.join(__dirname, "..");
const OFFERS_DIR = path.join(ROOT, "offer");
const MANIFEST_PATH = path.join(OFFERS_DIR, ".manifest.json");
const SITEMAP_OFFERS_PATH = path.join(ROOT, "sitemap-offers.xml");
const SITE_ORIGIN = "https://himmat.sa";
const FALLBACK_IMAGE = `${SITE_ORIGIN}/Himmat-Almedina.png`;

async function supaSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    console.error(`فشل جلب ${table}:`, res.status, await res.text().catch(() => ""));
    return [];
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function stripMarkdown(s) {
  return String(s ?? "").replace(/\*\*/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
}

function money(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("ar-SA") : null;
}

// وصف قصير (~155 حرف، الحد العملي المعتاد لمقتطفات البحث/معاينات المشاركة).
function buildDescription(offer) {
  const cleaned = stripMarkdown(offer.description || "");
  const price = money(offer.price_final || offer.price_original);
  const priceLine = price ? `السعر ${price} ريال سعودي. ` : "";
  const base = `${offer.property_type || "عقار"} في حي ${offer.district}، ${offer.city}. ${priceLine}${cleaned}`;
  return base.length > 155 ? base.slice(0, 152).trimEnd() + "…" : base;
}

function firstImage(offer) {
  if (Array.isArray(offer.image_urls) && offer.image_urls.length > 0) return offer.image_urls[0];
  if (offer.image_url) return offer.image_url;
  return FALLBACK_IMAGE;
}

function buildOfferHtml(template, offer) {
  const title = `${offer.title} — ${offer.district}، ${offer.city} | همة المدينة العقارية`;
  const description = buildDescription(offer);
  const image = firstImage(offer);
  const url = `${SITE_ORIGIN}/offer/${offer.id}/`;

  let html = template;
  // الصفحة منسوخة داخل مجلد فرعي (offer/<id>/)، فالروابط النسبية
  // بالملف الأصلي (style.css, js/site.js...) تنكسر بدون هذا السطر —
  // <base> يخلي المتصفح يقرأها دايماً من جذر الموقع (2026-09-23،
  // تصحيح فوري بعد اكتشاف الصفحة المولَّدة تطلع بدون تنسيق ولا جافاسكربت).
  html = html.replace(
    '<meta charset="UTF-8">',
    '<meta charset="UTF-8">\n<base href="https://himmat.sa/">'
  );
  html = html.replace(
    "<title>همة المدينة العقارية — Himmat Al Madinah Real Estate</title>",
    `<title>${escapeHtml(title)}</title>`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeHtml(description)}">`
  );
  html = html.replace(
    '<meta property="og:url" content="https://himmat.sa/">',
    `<meta property="og:url" content="${url}">`
  );
  html = html.replace(
    '<meta property="og:title" content="همة المدينة العقارية">',
    `<meta property="og:title" content="${escapeHtml(title)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${escapeHtml(description)}">`
  );
  html = html.replace(
    /<meta property="og:image" content="[^"]*">/,
    `<meta property="og:image" content="${escapeHtml(image)}">`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`
  );
  html = html.replace(
    /<meta name="twitter:image" content="[^"]*">/,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`
  );
  html = html.replace(
    '<link rel="canonical" href="https://himmat.sa/">',
    `<link rel="canonical" href="${url}">`
  );
  return html;
}

function buildSitemap(offerIds) {
  const urls = offerIds
    .map((id) => `  <url>\n    <loc>${SITE_ORIGIN}/offer/${id}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function main() {
  const templatePath = path.join(ROOT, "index.html");
  const template = fs.readFileSync(templatePath, "utf8");

  const offers = await supaSelect(
    "offers",
    "select=id,title,description,price_final,price_original,city,district,property_type,image_url,image_urls&is_published=eq.true&deleted_at=is.null"
  );

  if (!fs.existsSync(OFFERS_DIR)) fs.mkdirSync(OFFERS_DIR, { recursive: true });

  const previousIds = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : [];
  const currentIds = offers.map((o) => o.id);

  // توليد/تحديث صفحة كل عرض حالي
  for (const offer of offers) {
    const dir = path.join(OFFERS_DIR, offer.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), buildOfferHtml(template, offer), "utf8");
  }

  // تنظيف: أي عرض بالقائمة القديمة وغير موجود بالقائمة الحالية = مجلده يُحذف
  const removed = previousIds.filter((id) => !currentIds.includes(id));
  for (const id of removed) {
    const dir = path.join(OFFERS_DIR, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(currentIds, null, 2), "utf8");
  fs.writeFileSync(SITEMAP_OFFERS_PATH, buildSitemap(currentIds), "utf8");

  console.log(`تم توليد ${offers.length} صفحة عرض، وحذف ${removed.length} صفحة قديمة.`);
}

main().catch((err) => {
  console.error("فشل توليد صفحات العروض:", err);
  process.exit(1);
});
