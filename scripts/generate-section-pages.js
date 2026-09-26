#!/usr/bin/env node
/**
 * scripts/generate-section-pages.js
 * ============================================================================
 * المستوى الثالث من إصلاح السيو (2026-09-26) — شقيق generate-offer-pages.js.
 *
 * المشكلة (مؤكَّدة بفحص Google Search Console المباشر، 2026-09-26):
 * مسارات الأقسام (/offers، /valuation...) ما لها ملف حقيقي، فـGitHub Pages
 * يرجّع 404.html (كود 404 + noindex) قبل تحويل جافاسكربت — جوجل يعتبرها
 * "Not found (404)" ولا يفهرسها أبداً. الموقع كان بعيون جوجل صفحة وحدة.
 *
 * الحل: ملف حقيقي لكل قسم بجذر الموقع (offers.html، valuation.html...) —
 * GitHub Pages يخدم /offers من offers.html مباشرة بكود 200، بدون تحويل
 * ولا شرطة مائلة بالنهاية، فيبقى location.pathname = "/offers" تماماً كما
 * يتوقعه site.js (صفر تعديل على منطق التوجيه).
 *
 * كل ملف = نسخة من index.html بالضبط، بس العنوان/الوصف/canonical/og/twitter
 * خاصة بالقسم. نصوص ثابتة مكتوبة هنا — صفر اتصال بقاعدة البيانات، صفر
 * مفاتيح، صفر مدخلات من مستخدمين.
 *
 * أمان ضد الفشل الصامت: لو أي وسم متوقَّع ما انوجد بـindex.html (مثلاً تغيّرت
 * صياغته)، السكربت يتوقف بخطأ قبل كتابة أي ملف — بدل ما ينشر صفحات
 * canonical حقها يشير للرئيسية (فيعتبرها جوجل نسخاً مكررة بصمت).
 *
 * يشتغل ضمن .github/workflows/generate-snapshot.yml بعد سكربت اللقطة (اللي
 * يعدّل index.html نفسه)، عشان النسخ تكون دايماً من آخر نسخة.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_ORIGIN = "https://himmat.sa";

const SECTIONS = {
  offers: {
    title: "عروض عقارية في المدينة المنورة | همة المدينة العقارية",
    description: "تصفّح عروضاً عقارية محدّثة، وابحث حسب المدينة ونوع العقار والسعر وعدد الغرف، أو جاوب ٤ أسئلة ونرشّح لك الأنسب. من مكتب مرخّص من الهيئة العامة للعقار.",
  },
  valuation: {
    title: "سعر المتر ومؤشر أسعار العقار في المدينة المنورة | همة",
    description: "مؤشر سعري استرشادي لعقارك مبني على سعر المتر لكل حي من صفقات موثّقة (وزارة العدل عبر رغدان)، محدَّث أسبوعياً، مع حاسبة التمويل العقاري ومقارنة الأحياء.",
  },
  contracts: {
    title: "كتابة عقود الإيجار السكنية والتجارية | همة المدينة العقارية",
    description: "نموذج استرشادي لكتابة عقد إيجار سكني أو تجاري مع جدول دفعاته كاملاً، لكل مدن المملكة، من همة المدينة العقارية.",
  },
  "add-property": {
    title: "اعرض عقارك في المدينة المنورة | همة المدينة العقارية",
    description: "أضف عقارك لقاعدة بياناتنا بدقائق، ويظهر للباحثين بعد مراجعة سريعة من فريقنا لضمان جودة العروض.",
  },
  services: {
    title: "خدماتنا العقارية: تسويق، إدارة أملاك، عقود | همة",
    description: "خدمات عقارية بالمدينة المنورة مبنية على معرفة السوق: البيع والشراء والتسويق والاستثمار العقاري وإدارة الأملاك وكتابة العقود.",
  },
  about: {
    title: "عن همة المدينة العقارية — مكتب عقاري مرخّص",
    description: "مكتب عقاري بالمدينة المنورة مرخّص من الهيئة العامة للعقار (رخصة فال 1200030428، سجل تجاري 7042103650). رسالتنا: تعامل عقاري أوضح وأكثر ثقة.",
  },
  contact: {
    title: "تواصل مع همة المدينة العقارية — المدينة المنورة",
    description: "تواصل معنا بالجوال أو واتساب أو البريد، أو أرسل استفسارك مباشرة. ساعات العمل: الأحد إلى الخميس، ٩ صباحاً إلى ٦ مساءً.",
  },
  faq: {
    title: "الأسئلة الشائعة | همة المدينة العقارية",
    description: "إجابات عن أكثر الأسئلة تكراراً حول خدماتنا العقارية، ومؤشر الأسعار، وإضافة العقارات، وكتابة العقود.",
  },
  analytics: {
    title: "العقارات المسجّلة ومتوسط سعر المتر حسب المدينة | همة",
    description: "استعرض العقارات المعتمدة بقاعدة بياناتنا ومتوسط سعر المتر لكل مدينة، ببيانات حقيقية مشتركة بين كل الزوار.",
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** استبدال إلزامي: لازم يطابق مرة وحدة بالضبط، وإلا نوقف كل شي. */
function mustReplace(html, find, replacement, label) {
  const count = typeof find === "string"
    ? html.split(find).length - 1
    : (html.match(new RegExp(find.source, "g")) || []).length;
  if (count !== 1) {
    throw new Error(`الوسم "${label}" متوقَّع مرة وحدة بـindex.html، لكن وُجد ${count} مرة — توقّف بدون كتابة أي ملف.`);
  }
  return html.replace(find, replacement);
}

function buildSectionHtml(template, slug, { title, description }) {
  const url = `${SITE_ORIGIN}/${slug}`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  let html = template;
  html = mustReplace(html, "<title>همة المدينة العقارية — Himmat Al Madinah Real Estate</title>", `<title>${t}</title>`, "title");
  html = mustReplace(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`, "description");
  html = mustReplace(html, '<meta property="og:url" content="https://himmat.sa/">', `<meta property="og:url" content="${url}">`, "og:url");
  html = mustReplace(html, '<meta property="og:title" content="همة المدينة العقارية">', `<meta property="og:title" content="${t}">`, "og:title");
  html = mustReplace(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`, "og:description");
  html = mustReplace(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`, "twitter:title");
  html = mustReplace(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${d}">`, "twitter:description");
  html = mustReplace(html, '<link rel="canonical" href="https://himmat.sa/">', `<link rel="canonical" href="${url}">`, "canonical");
  return html;
}

function main() {
  const template = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  // نبني الكل بالذاكرة أولاً — لو فشل أي قسم، ما ينكتب ولا ملف (كل شي أو لا شي).
  const outputs = Object.entries(SECTIONS).map(([slug, meta]) => [slug, buildSectionHtml(template, slug, meta)]);
  for (const [slug, html] of outputs) {
    fs.writeFileSync(path.join(ROOT, `${slug}.html`), html, "utf8");
  }
  console.log(`[generate-section-pages] تم توليد ${outputs.length} صفحة قسم: ${outputs.map(([s]) => s).join("، ")}`);
}

try {
  main();
} catch (e) {
  console.error("[generate-section-pages] فشل:", e.message);
  process.exit(1);
}
