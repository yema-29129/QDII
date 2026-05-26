import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(await fs.readFile(path.join(ROOT, "data/qdii-funds.json"), "utf8"));

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
};

async function fetchText(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function cleanText(html = "") {
  return html
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeeLimit(html) {
  const amountIndex = html.indexOf("<label class=\"left\">申购与赎回金额");
  if (amountIndex === -1) return "";
  const section = html.slice(amountIndex, html.indexOf('<div class="box"', amountIndex + 20));
  const cells = [...section.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1]));
  for (let i = 0; i < cells.length - 1; i += 2) {
    if (cells[i] === "日累计申购限额") return cells[i + 1] || "";
  }
  return "";
}

function parseBasicLimit(html) {
  const text = cleanText(html);
  const limitMatch = text.match(/单日累计购买上限\s*([0-9,]+(?:\.\d+)?\s*(?:元|美元|美金|人民币))/);
  return limitMatch ? limitMatch[1].replace(/\s+/g, "") : "";
}

function normalize(value = "") {
  return value
    .replace(/人民币/g, "元")
    .replace(/美金/g, "美元")
    .replace(/\.00(?=元|美元)/g, "")
    .replace(/\s+/g, "")
    .replace(/---|--/g, "");
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const rows = await mapLimit(data.funds, 10, async (fund, index) => {
  const [feeHtml, basicHtml] = await Promise.all([
    fetchText(`https://fundf10.eastmoney.com/jjfl_${fund.code}.html`).catch(() => ""),
    fetchText(`https://fundf10.eastmoney.com/jbgk_${fund.code}.html`).catch(() => ""),
  ]);
  const feeLimit = feeHtml ? parseFeeLimit(feeHtml) : "";
  const basicLimit = basicHtml ? parseBasicLimit(basicHtml) : "";
  const finalLimit = fund.fees?.amounts?.dailyPurchaseLimit || "";
  const conflict =
    feeLimit && basicLimit && normalize(feeLimit) && normalize(basicLimit) && normalize(feeLimit) !== normalize(basicLimit);
  const missing = !normalize(finalLimit);
  if ((index + 1) % 50 === 0 || index === data.funds.length - 1) {
    console.log(`Audited ${index + 1}/${data.funds.length}`);
  }
  return {
    code: fund.code,
    name: fund.name,
    focus: fund.focus,
    currency: fund.currency,
    finalLimit,
    limitSource: fund.limitSource || "",
    feeLimit,
    basicLimit,
    status: conflict ? "冲突" : missing ? "未抓到公开限额" : "一致/单源",
  };
});

await fs.writeFile(path.join(ROOT, "data/limit-audit.json"), `${JSON.stringify(rows, null, 2)}\n`);
const csvRows = [
  ["代码", "名称", "标签", "币种", "最终限额", "限额来源", "F10购买信息限额", "F10基本概况限额", "审计状态"],
  ...rows.map((row) => [
    row.code,
    row.name,
    row.focus,
    row.currency,
    row.finalLimit,
    row.limitSource,
    row.feeLimit,
    row.basicLimit,
    row.status,
  ]),
];
await fs.writeFile(path.join(ROOT, "data/limit-audit.csv"), `${csvRows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`);

const summary = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
console.log(summary);
console.log("Conflicts:");
for (const row of rows.filter((item) => item.status === "冲突")) {
  console.log(row.code, row.name, "final=", row.finalLimit, "fee=", row.feeLimit, "basic=", row.basicLimit, "source=", row.limitSource);
}
