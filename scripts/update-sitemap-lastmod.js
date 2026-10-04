#!/usr/bin/env node
/**
 * scripts/update-sitemap-lastmod.js — تحديث lastmod لـ sitemap.xml (2026-10-04)
 * ============================================================================
 * قبل: lastmod ثابت يدوياً (2026-09-22) لكل الصفحات الرئيسية = إشارة حداثة كاذبة.
 * الحين: كل صفحة تاخذ تاريخ **آخر إيداع حقيقي** غيّر ملفها من Git، مع استثناء
 * إيداعات البوت (himmat-snapshot-bot) — لأن البوت يعدّل الملفات يومياً بلقطة
 * المحتوى، وهذا ما يعني تغييراً يهمّ الزائر.
 *
 * أمان: لو ما توفر تاريخ Git (نسخة shallow أو ملف غير متتبَّع) تبقى القيمة
 * الحالية كما هي ويطبع تحذير — ما يفشل ولا يكتب تاريخ مخترع.
 * يعدّل نص <lastmod> فقط، ما يلمس أي شيء ثاني بالملف.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const BOT = "himmat-snapshot-bot";

/** https://himmat.sa/ ← index.html ، /offers ← offers.html */
function fileForLoc(loc) {
  const p = new URL(loc).pathname.replace(/^\/+|\/+$/g, "");
  return p === "" ? "index.html" : `${decodeURIComponent(p)}.html`;
}

/** يعيد xml جديد؛ dateFor(file) يرجّع YYYY-MM-DD أو null (= لا تغيّر). */
function rewrite(xml, dateFor) {
  let changed = 0;
  const out = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    if (!loc) return block;
    const d = dateFor(fileForLoc(loc));
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return block;
    if (!/<lastmod>[^<]*<\/lastmod>/.test(block)) return block;
    const nb = block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${d}</lastmod>`);
    if (nb !== block) changed++;
    return nb;
  });
  return { xml: out, changed };
}

function gitDate(file) {
  if (!fs.existsSync(path.join(ROOT, file))) return null;
  try {
    const s = execFileSync("git", ["log", "-1", "--format=%cs", "--invert-grep", `--author=${BOT}`, "--", file],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return s || null;
  } catch { return null; }
}

function main() {
  const xml = fs.readFileSync(SITEMAP, "utf8");
  const missing = [];
  const { xml: out, changed } = rewrite(xml, (f) => { const d = gitDate(f); if (!d) missing.push(f); return d; });
  if (missing.length) console.warn("⚠️ لا تاريخ Git لـ: " + missing.join(", ") + " — أُبقيت قيمها الحالية.");
  if (out !== xml) fs.writeFileSync(SITEMAP, out);
  console.log(`sitemap.xml: ${changed} صفحة تغيّر lastmod.`);
}

if (require.main === module) main();
module.exports = { fileForLoc, rewrite };
