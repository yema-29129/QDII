import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const TODAY = process.env.QDII_DATE || new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const DATA_SOURCES = {
  ranking: "https://fund.eastmoney.com/data/rankhandler.aspx",
  fundSearch: "https://fund.eastmoney.com/js/fundcode_search.js",
  fundPage: "https://fund.eastmoney.com/pingzhongdata/{code}.js",
  feePage: "https://fundf10.eastmoney.com/jjfl_{code}.html",
  basicPage: "https://fundf10.eastmoney.com/jbgk_{code}.html",
  stageReturns: "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jdzf&code={code}",
  gfFundPage: "https://www.gffunds.com.cn/funds/?fromSearch=1&fundcode={code}",
  gfPersonLimit: "https://www.gffunds.com.cn/api/v1/funds/fund-person-limit.shtml?fundcode={code}",
  gfOrgLimit: "https://www.gffunds.com.cn/api/v1/funds/fund-org-limit.shtml?fundcode={code}",
  findFin: "https://findfin.app/zh/tools/us-etf-tracker",
  feixia: "https://feixia.org/",
};

const FALLBACK_US_TRACKER_CODES = [
  "012920",
  "539002",
  "017730",
  "006373",
  "005698",
  "501226",
  "008253",
  "006555",
  "100055",
  "501312",
  "159509",
  "016701",
  "017436",
  "017091",
  "017144",
  "161128",
  "000043",
  "019172",
  "160213",
  "018043",
  "159659",
  "513870",
  "159696",
  "016055",
  "016452",
  "159660",
  "019736",
  "159501",
  "513390",
  "019441",
  "000834",
  "019524",
  "513110",
  "161130",
  "159513",
  "159941",
  "016532",
  "159632",
  "019547",
  "539001",
  "015299",
  "018966",
  "040046",
  "513300",
  "050025",
  "513500",
  "159612",
  "017641",
  "161125",
  "017028",
  "513650",
  "007721",
  "018064",
  "096001",
];

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  Referer: "https://fund.eastmoney.com/data/fundranking.html",
};

function oneYearAgo(dateText) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setFullYear(date.getFullYear() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function fetchText(url, options = {}, retry = 3) {
  for (let attempt = 0; attempt < retry; attempt += 1) {
    try {
      const res = await fetch(url, { headers, ...options });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (error) {
      if (attempt === retry - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 750));
    }
  }
}

function cleanText(html = "") {
  return html
    .replace(/<strike[^>]*>(.*?)<\/strike>/gi, "$1")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function asPercent(value) {
  if (value === undefined || value === null || value === "" || value === "---") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return `${Number(value).toFixed(2)}%`;
}

function parseRanking(raw) {
  const datasMatch = raw.match(/datas:\[(.*)\],allRecords:/s);
  const totalMatch = raw.match(/allRecords:(\d+)/);
  if (!datasMatch) throw new Error("Cannot parse Eastmoney rankData response.");

  const list = JSON.parse(`[${datasMatch[1]}]`);
  return {
    total: totalMatch ? Number(totalMatch[1]) : list.length,
    funds: list.map((row) => {
      const parts = row.split(",");
      return {
        code: parts[0],
        name: parts[1],
        pinyin: parts[2],
        netValueDate: parts[3] || "",
        netValue: parts[4] || "",
        accumulatedNetValue: parts[5] || "",
        returns: {
          day: asPercent(parts[6]),
          week: asPercent(parts[7]),
          month: asPercent(parts[8]),
          threeMonths: asPercent(parts[9]),
          sixMonths: asPercent(parts[10]),
          oneYear: asPercent(parts[11]),
          twoYears: asPercent(parts[12]),
          threeYears: asPercent(parts[13]),
          yearToDate: asPercent(parts[14]),
          sinceInception: asPercent(parts[15]),
        },
        inceptionDate: parts[16] || "",
        buyFee: {
          source: parts[19] || "",
          current: parts[20] || "",
        },
      };
    }),
  };
}

function parseFundSearch(raw) {
  const json = raw.replace(/^\uFEFF?var\s+r\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(json).map(([code, pinyin, name, type, fullPinyin]) => ({
    code,
    pinyin,
    name,
    type,
    fullPinyin,
  }));
}

function parseExternalCodes(raw = "") {
  return [...new Set([...raw.matchAll(/(?:^|[^0-9])((?:0|1|5)[0-9]{5})(?:[^0-9])/g)].map((m) => m[1]))];
}

function inferCurrency(name) {
  if (/美元|美钞|现汇|USD/i.test(name)) return "美元";
  if (/港币|港元|HKD/i.test(name)) return "港币";
  return "人民币";
}

function inferShareClass(name) {
  const compact = name.replace(/\s+/g, "");
  const currencyThenClass = compact.match(/(?:人民币|美元|港币|港元)([A-Z])(?:类)?$/i);
  if (currencyThenClass?.[1]) return currencyThenClass[1].toUpperCase();
  const classThenCurrency = compact.match(/([A-Z])(?:类)?(?:人民币|美元|港币|港元)$/i);
  if (classThenCurrency?.[1]) return classThenCurrency[1].toUpperCase();
  const suffix = compact.match(/(?:^|[^A-Z])([A-Z])(?:类)?$/i);
  return suffix?.[1]?.toUpperCase() || "未标明";
}

function isExchangeTradedEtf(fund) {
  return /^(159|513|520)\d{3}$/.test(fund.code) && /ETF/.test(fund.name) && !/联接/.test(fund.name);
}

function classifyFocus(name) {
  if (/纳斯达克|纳指/i.test(name)) return "纳指";
  if (/标普500|标普\s*500|标普信息科技|标普美国消费|标普消费|标普100|标普生物科技|标普医疗保健/i.test(name)) {
    return "标普";
  }
  if (/美国成长|美国50|MSCI美国|道琼斯美国|道琼斯精选/i.test(name)) return "美国";
  if (/全球|海外|致远/i.test(name)) return "全球";
  return "其他";
}

function includeUsGlobalFund(fund, externalCodes) {
  const name = fund.name;
  const type = fund.type || "";
  const focus = classifyFocus(name);
  const qdiiLike = /QDII|海外|ETF|LOF/i.test(name + type);
  const excluded =
    /港币|港股|港股通|H股|恒生|中概|中证海外互联网|中国互联|中国|大中华|亚洲|亚太|新兴市场|印度|日本|日经|德国|法国|欧洲|英国|越南|东南亚|沙特|巴西|韩国|中韩|富时100|CAC/i.test(
      name,
    ) ||
    /黄金|原油|油气|石油|商品|天然资源|房地产|不动产|REIT|债|收益|票息|抗通胀|货币/i.test(name + type);

  if (excluded || !qdiiLike) return false;
  if (["纳指", "标普", "美国"].includes(focus)) return true;
  if (focus === "全球") return true;
  return externalCodes.has(fund.code);
}

function parseFeeRows(sectionHtml) {
  const rows = [];
  for (const rowMatch of sectionHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      cleanText(m[1]),
    );
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length >= 2 && !nonEmpty.some((cell) => /适用金额|适用期限|费率$|原费率/.test(cell))) {
      rows.push({ condition: nonEmpty[0], rate: nonEmpty.slice(1).join(" | ") });
    }
  }
  return rows;
}

function findSection(html, title) {
  const index = html.indexOf(`<label class="left">${title}`);
  if (index === -1) return "";
  const next = html.indexOf('<div class="box"', index + 20);
  return html.slice(index, next === -1 ? undefined : next);
}

function parseLabeledPairs(sectionHtml) {
  const cells = [...sectionHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1]));
  const pairs = {};
  for (let i = 0; i < cells.length - 1; i += 2) {
    if (cells[i]) pairs[cells[i]] = cells[i + 1] || "";
  }
  return pairs;
}

function parseFees(html) {
  const trading = parseLabeledPairs(findSection(html, "交易状态"));
  const amounts = parseLabeledPairs(findSection(html, "申购与赎回金额"));
  const operation = parseLabeledPairs(findSection(html, "运作费用"));
  return {
    tradingStatus: {
      purchase: trading["申购状态"] || "",
      redemption: trading["赎回状态"] || "",
      fixedInvestment: trading["定投状态"] || "",
    },
    amounts: {
      minPurchase: amounts["申购起点"] || "",
      fixedInvestmentMin: amounts["定投起点"] || "",
      dailyPurchaseLimit: amounts["日累计申购限额"] || "",
      firstPurchase: amounts["首次购买"] || "",
      additionalPurchase: amounts["追加购买"] || "",
      holdingLimit: amounts["持仓上限"] || "",
      minRedemptionShare: amounts["最小赎回份额"] || "",
      minRemainingShare: amounts["部分赎回最低保留份额"] || "",
    },
    operatingFees: {
      management: operation["管理费率"] || "",
      custody: operation["托管费率"] || "",
      salesService: operation["销售服务费率"] || "",
    },
    subscriptionFees: parseFeeRows(findSection(html, "认购费率")),
    purchaseFees: parseFeeRows(findSection(html, "申购费率")),
    redemptionFees: parseFeeRows(findSection(html, "赎回费率")),
  };
}

function parseBasicLimit(html) {
  const text = cleanText(html);
  const limitMatch = text.match(/单日累计购买上限\s*([0-9,]+(?:\.\d+)?\s*(?:元|美元|美金|人民币))/);
  const statusMatch = text.match(/交易状态：\s*([^成]+?)(?:成立日期|基金经理|类型|管理人|净资产|$)/);
  return {
    dailyPurchaseLimit: limitMatch ? limitMatch[1].replace(/\s+/g, "") : "",
    statusText: statusMatch ? statusMatch[1].trim() : "",
  };
}

function formatGfLimit(personLimit, orgLimit, currency) {
  const unit = currency === "美元" ? "美元" : "元";
  const personMax = personLimit?.MAX_ALLOT_BALA || "";
  const orgMax = orgLimit?.MAX_ALLOT_BALA || "";
  const personMin = personLimit?.MIN_ALLOT_BALA || "";
  const orgMin = orgLimit?.MIN_ALLOT_BALA || "";
  const sameMax = personMax && orgMax && personMax === orgMax;
  const sameMin = personMin && orgMin && personMin === orgMin;
  return {
    minPurchase: sameMin ? `${personMin}${unit}` : [personMin && `个人${personMin}${unit}`, orgMin && `机构${orgMin}${unit}`].filter(Boolean).join(" / "),
    dailyPurchaseLimit: sameMax ? `${personMax}${unit}` : [personMax && `个人${personMax}${unit}`, orgMax && `机构${orgMax}${unit}`].filter(Boolean).join(" / "),
    raw: { person: personLimit || null, org: orgLimit || null },
  };
}

async function fetchGfLimit(code, currency) {
  const [person, org] = await Promise.all([
    fetchText(DATA_SOURCES.gfPersonLimit.replace("{code}", code)).then(JSON.parse).catch(() => null),
    fetchText(DATA_SOURCES.gfOrgLimit.replace("{code}", code)).then(JSON.parse).catch(() => null),
  ]);
  if (person?.ERROR && org?.ERROR) return null;
  const formatted = formatGfLimit(person?.ERROR ? null : person, org?.ERROR ? null : org, currency);
  if (!formatted.dailyPurchaseLimit && !formatted.minPurchase) return null;
  return {
    source: "广发基金官网直销限额接口",
    sourceUrl: DATA_SOURCES.gfFundPage.replace("{code}", code),
    ...formatted,
  };
}

function parseStageReturns(raw) {
  const returns = {};
  const labels = {
    "近1年": "oneYear",
    "近3年": "threeYears",
    "近5年": "fiveYears",
  };
  for (const [label, key] of Object.entries(labels)) {
    const match = raw.match(
      new RegExp(`${label}<\\/li><li class='tor [^']+ bold'>([^<]+)<\\/li>`),
    );
    if (match) returns[key] = asPercent(match[1]);
  }
  return returns;
}

function parseArrayVar(script, varName, nextComment) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = nextComment
    ? new RegExp(`var\\s+${escaped}\\s*=\\s*([\\s\\S]*?);\\/\\*${nextComment}`)
    : new RegExp(`var\\s+${escaped}\\s*=\\s*([\\s\\S]*?);`);
  const match = script.match(re);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function addYears(timestamp, years) {
  const date = new Date(timestamp);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime();
}

function findAtOrBefore(points, timestamp) {
  let low = 0;
  let high = points.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid][0] <= timestamp) {
      found = points[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function calcPeriodReturn(points, years) {
  if (!points?.length) return { value: null, baseDate: "" };
  const latest = points[points.length - 1];
  const base = findAtOrBefore(points, addYears(latest[0], -years));
  if (!base || base[0] === latest[0] || !base[1] || !latest[1]) return { value: null, baseDate: "" };
  return {
    value: Number(((latest[1] / base[1] - 1) * 100).toFixed(2)),
    baseDate: new Date(base[0]).toISOString().slice(0, 10),
    latestDate: new Date(latest[0]).toISOString().slice(0, 10),
  };
}

function parseFundScript(script) {
  const clean = script.replace(/^\uFEFF/, "");
  const cumulative = parseArrayVar(clean, "Data_ACWorthTrend", "累计收益率走势");
  const name = clean.match(/var\s+fS_name\s*=\s*"([^"]*)"/)?.[1] || "";
  const sourceRate = clean.match(/var\s+fund_sourceRate\s*=\s*"([^"]*)"/)?.[1] || "";
  const currentRate = clean.match(/var\s+fund_Rate\s*=\s*"([^"]*)"/)?.[1] || "";
  const minPurchase = clean.match(/var\s+fund_minsg\s*=\s*"([^"]*)"/)?.[1] || "";
  const latest = cumulative?.at(-1);
  return {
    name,
    sourceRate,
    currentRate,
    minPurchase,
    latestNetValue: latest?.[1] ?? "",
    latestNetValueDate: latest ? new Date(latest[0]).toISOString().slice(0, 10) : "",
    calculatedReturns: {
      oneYear: calcPeriodReturn(cumulative, 1),
      threeYears: calcPeriodReturn(cumulative, 3),
      fiveYears: calcPeriodReturn(cumulative, 5),
      tenYears: calcPeriodReturn(cumulative, 10),
    },
  };
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

function toCsvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(funds) {
  const headers = [
    "基金代码",
    "基金名称",
    "币种",
    "份额类别",
    "市场标签",
    "交易场所",
    "净值日期",
    "近1年收益率",
    "近3年收益率",
    "近5年收益率",
    "近10年收益率",
    "日累计申购限额",
    "限额来源",
    "申购状态",
    "赎回状态",
    "天天基金申购费",
    "管理费率",
    "托管费率",
    "销售服务费率",
    "申购费率明细",
    "赎回费率明细",
    "定期报告链接",
  ];
  const rows = funds.map((fund) => [
    fund.code,
    fund.name,
    fund.currency,
    fund.shareClass,
    fund.focus,
    fund.tradingVenue,
    fund.netValueDate,
    formatPercent(fund.returns.oneYear),
    formatPercent(fund.returns.threeYears),
    formatPercent(fund.returns.fiveYears),
    formatPercent(fund.returns.tenYears),
    fund.fees.amounts.dailyPurchaseLimit,
    fund.limitSource || "",
    fund.fees.tradingStatus.purchase,
    fund.fees.tradingStatus.redemption,
    fund.buyFee.current,
    fund.fees.operatingFees.management,
    fund.fees.operatingFees.custody,
    fund.fees.operatingFees.salesService,
    fund.fees.purchaseFees.map((row) => `${row.condition}: ${row.rate}`).join("；"),
    fund.fees.redemptionFees.map((row) => `${row.condition}: ${row.rate}`).join("；"),
    fund.links.report,
  ]);
  return [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const [searchRaw, findFinRaw, feixiaRaw] = await Promise.all([
    fetchText(DATA_SOURCES.fundSearch),
    fetchText(DATA_SOURCES.findFin).catch(() => ""),
    fetchText(DATA_SOURCES.feixia).catch(() => ""),
  ]);
  const allFunds = parseFundSearch(searchRaw);
  const externalCodes = new Set([
    ...FALLBACK_US_TRACKER_CODES,
    ...parseExternalCodes(findFinRaw),
    ...parseExternalCodes(feixiaRaw),
  ]);

  const rankUrl = new URL(DATA_SOURCES.ranking);
  rankUrl.search = new URLSearchParams({
    op: "ph",
    dt: "kf",
    ft: "QDII",
    rs: "",
    gs: "0",
    sc: "1nzf",
    st: "desc",
    sd: oneYearAgo(TODAY),
    ed: TODAY,
    qdii: "",
    tabSubtype: ",,,,,",
    pi: "1",
    pn: "10000",
    dx: "1",
    v: String(Date.now()),
  }).toString();

  console.log(`Fetching QDII ranking: ${rankUrl}`);
  const ranking = parseRanking(await fetchText(rankUrl));
  const rankingByCode = new Map(ranking.funds.map((fund) => [fund.code, fund]));
  const candidates = allFunds
    .filter((fund) => includeUsGlobalFund(fund, externalCodes))
    .map((fund) => {
      const ranked = rankingByCode.get(fund.code);
      return {
        ...(ranked || {
          code: fund.code,
          name: fund.name,
          pinyin: fund.pinyin,
          netValueDate: "",
          netValue: "",
          accumulatedNetValue: "",
          returns: {},
          inceptionDate: "",
          buyFee: { source: "", current: "" },
        }),
        name: ranked?.name || fund.name,
        pinyin: ranked?.pinyin || fund.pinyin,
        searchType: fund.type,
        focus: classifyFocus(fund.name),
      };
    })
    .sort((a, b) => {
      const focusOrder = { 纳指: 0, 标普: 1, 美国: 2, 全球: 3, 其他: 4 };
      return (
        (focusOrder[a.focus] ?? 9) - (focusOrder[b.focus] ?? 9) ||
        a.name.localeCompare(b.name, "zh-CN") ||
        a.code.localeCompare(b.code)
      );
    });
  console.log(
    `Found ${ranking.funds.length} open QDII rows; selected ${candidates.length} US/global candidates from ${allFunds.length} fund-search rows.`,
  );

  const funds = await mapLimit(candidates, 8, async (fund, idx) => {
    const code = fund.code;
    const [feeHtml, basicHtml, stageRaw, fundScript] = await Promise.all([
      fetchText(DATA_SOURCES.feePage.replace("{code}", code)).catch((error) => {
        console.warn(`Fee page failed for ${code}: ${error.message}`);
        return "";
      }),
      fetchText(DATA_SOURCES.basicPage.replace("{code}", code)).catch(() => ""),
      fetchText(DATA_SOURCES.stageReturns.replace("{code}", code)).catch((error) => {
        console.warn(`Stage return failed for ${code}: ${error.message}`);
        return "";
      }),
      fetchText(`${DATA_SOURCES.fundPage.replace("{code}", code)}?v=${Date.now()}`).catch((error) => {
        console.warn(`Fund trend failed for ${code}: ${error.message}`);
        return "";
      }),
    ]);
    const parsedFundScript = fundScript ? parseFundScript(fundScript) : { calculatedReturns: {} };
    const calculated = parsedFundScript.calculatedReturns;
    const stageReturns = stageRaw ? parseStageReturns(stageRaw) : {};
    const exchangeEtf = isExchangeTradedEtf(fund);
    const fees = feeHtml ? parseFees(feeHtml) : parseFees("");
    const basicLimit = basicHtml ? parseBasicLimit(basicHtml) : {};
    if (exchangeEtf) {
      fees.tradingStatus.purchase ||= "场内交易";
      fees.tradingStatus.redemption ||= "场内交易";
      fees.amounts.dailyPurchaseLimit ||= "场内交易";
      fees.amounts.minPurchase ||= "场内交易";
      fees.purchaseFees = fees.purchaseFees.length ? fees.purchaseFees : [{ condition: "场内交易", rate: "按券商交易佣金" }];
      fees.redemptionFees = fees.redemptionFees.length ? fees.redemptionFees : [{ condition: "场内交易", rate: "按券商交易佣金" }];
    }
    fees.operatingFees.salesService ||= "未披露/不适用";
    let limitSource = fees.amounts.dailyPurchaseLimit ? "天天基金F10购买信息" : "";
    let limitSourceUrl = DATA_SOURCES.feePage.replace("{code}", code);
    if (basicLimit.dailyPurchaseLimit) {
      fees.amounts.dailyPurchaseLimit = basicLimit.dailyPurchaseLimit;
      limitSource = "天天基金F10基本概况实时交易状态";
      limitSourceUrl = DATA_SOURCES.basicPage.replace("{code}", code);
    }
    if (/^广发/.test(fund.name)) {
      const gfLimit = await fetchGfLimit(code, inferCurrency(fund.name));
      if (gfLimit?.dailyPurchaseLimit) {
        fees.amounts.dailyPurchaseLimit = gfLimit.dailyPurchaseLimit;
        fees.amounts.minPurchase = gfLimit.minPurchase || fees.amounts.minPurchase;
        limitSource = gfLimit.source;
        limitSourceUrl = gfLimit.sourceUrl;
      }
    }
    if ((idx + 1) % 25 === 0 || idx === candidates.length - 1) {
      console.log(`Processed ${idx + 1}/${candidates.length}`);
    }
    return {
      ...fund,
      name: parsedFundScript.name || fund.name,
      fundType: fund.searchType || "",
      tradingVenue: exchangeEtf ? "场内ETF" : "场外/联接/LOF",
      currency: inferCurrency(fund.name),
      shareClass: inferShareClass(fund.name),
      focus: classifyFocus(fund.name),
      returns: {
        ...fund.returns,
        oneYear: stageReturns.oneYear ?? fund.returns.oneYear ?? calculated.oneYear?.value ?? null,
        threeYears: stageReturns.threeYears ?? fund.returns.threeYears ?? calculated.threeYears?.value ?? null,
        fiveYears: stageReturns.fiveYears ?? calculated.fiveYears?.value ?? null,
        tenYears: calculated.tenYears?.value ?? null,
      },
      returnBaseDates: {
        oneYear: calculated.oneYear?.baseDate || "",
        threeYears: calculated.threeYears?.baseDate || "",
        fiveYears: calculated.fiveYears?.baseDate || "",
        tenYears: calculated.tenYears?.baseDate || "",
        latest: calculated.oneYear?.latestDate || fund.netValueDate || "",
      },
      buyFee: {
        source: fund.buyFee?.source || (parsedFundScript.sourceRate ? `${parsedFundScript.sourceRate}%` : ""),
        current: fund.buyFee?.current || (parsedFundScript.currentRate ? `${parsedFundScript.currentRate}%` : ""),
      },
      netValueDate: fund.netValueDate || parsedFundScript.latestNetValueDate,
      netValue: fund.netValue || parsedFundScript.latestNetValue,
      fees,
      limitSource,
      limitSourceUrl,
      links: {
        fund: `https://fund.eastmoney.com/${code}.html`,
        fees: `https://fundf10.eastmoney.com/jjfl_${code}.html`,
        report: `https://fundf10.eastmoney.com/jjgg_${code}_3.html`,
        archives: `https://fundf10.eastmoney.com/jbgk_${code}.html`,
      },
    };
  });

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    date: TODAY,
    count: funds.length,
    sourceCount: ranking.total,
    allFundSearchCount: allFunds.length,
    externalReferenceCount: externalCodes.size,
    sources: DATA_SOURCES,
    note:
      "范围已筛选为美国/全球市场 QDII，覆盖纳指、标普、美国宽基/主动美股、全球权益主题，并剔除港股、日本、印度、债券、商品、黄金、油气、REIT 等非本次目标品类。数据自动抓取自东方财富/天天基金公开页面，并用 FindFin、FEIXIA 的纳指/标普清单交叉补漏。费率、限额和交易状态可能随公告变化，使用前请以基金公司和销售平台最新公告为准。",
    funds,
  };

  await fs.writeFile(path.join(DATA_DIR, "qdii-funds.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(DATA_DIR, "qdii-funds.csv"), `${buildCsv(funds)}\n`);
  console.log(`Wrote data/qdii-funds.json and data/qdii-funds.csv at ${generatedAt}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
