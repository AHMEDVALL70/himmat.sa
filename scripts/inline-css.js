/**
 * تضمين css/site.css داخل index.html (2026-10-05).
 *
 * لماذا: الـCSS الخارجي كان الجولة الشبكية الوحيدة القابلة للإزالة من المسار الحرج؛
 * تضمينه خفّض FCP من ~1300ms إلى ~730ms بالقياس المخبري، وعزل الصفحة عن تقلّب
 * استجابة الخادم (في قياس PageSpeed بطيء: HTML 173ms وsite.css 311ms).
 *
 * المصدر الوحيد يبقى css/site.css — لا تعدّل وسم <style id="site-css"> يدوياً.
 * هذا السكربت يعيد توليده (آمن للتكرار): يشتغل أول خطوة بالـAction، وفحص smoke
 * (#41) يمنع دفع index.html ما تطابق مع css/site.css.
 *
 * صفحات الأقسام والعروض تُولَّد من index.html فترث التضمين تلقائياً.
 * مسارات url(../assets/...) تُحوَّل لمطلقة /assets/... لأن الصفحة المولَّدة بمجلد فرعي.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LINK_RE = /<link rel="stylesheet" href="css\/site\.css[^"]*">/;
const STYLE_RE = /<style id="site-css">[\s\S]*?<\/style>/;

function buildStyleTag(css) {
  if (/<\/style/i.test(css)) throw new Error("css/site.css يحتوي </style — لا يمكن تضمينه بأمان.");
  const body = css
    .replace(/url\((['"]?)\.\.\/assets\//g, "url($1/assets/")
    .replace(/\s+$/, "");
  if (/\.\.\//.test(body.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    throw new Error("بقي مسار نسبي ../ داخل CSS بعد التحويل — يحتاج معالجة قبل التضمين.");
  }
  return `<style id="site-css">\n${body}\n</style>`;
}

function inlineCss(html, css) {
  const tag = buildStyleTag(css);
  const hasLink = LINK_RE.test(html);
  const hasStyle = STYLE_RE.test(html);
  if (hasLink === hasStyle) {
    throw new Error(`حالة غير متوقعة بـindex.html: link=${hasLink} style=${hasStyle} (المتوقع واحد منهما فقط) — توقّف بدون كتابة.`);
  }
  return html.replace(hasLink ? LINK_RE : STYLE_RE, () => tag);
}

function main() {
  const indexPath = path.join(ROOT, "index.html");
  const css = fs.readFileSync(path.join(ROOT, "css", "site.css"), "utf8");
  const html = fs.readFileSync(indexPath, "utf8");
  const out = inlineCss(html, css);
  if (out !== html) {
    fs.writeFileSync(indexPath, out, "utf8");
    console.log("تم تحديث الـCSS المضمَّن بـindex.html.");
  } else {
    console.log("الـCSS المضمَّن مطابق — لا تغيير.");
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error("فشل تضمين CSS:", e.message); process.exit(1); }
}

module.exports = { inlineCss, buildStyleTag };
