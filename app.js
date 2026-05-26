const state = {
  funds: [],
  filtered: [],
  sortKey: "focus",
  sortDir: "asc",
};

const $ = (selector) => document.querySelector(selector);

function loadJson(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText));
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(`HTTP ${request.status}`));
      }
    };
    request.onerror = () => reject(new Error("网络请求失败"));
    request.send();
  });
}

function getValue(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(2);
}

function percentClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value >= 0 ? "positive" : "negative";
}

function hasLimit(fund) {
  const text = fund.fees?.amounts?.dailyPurchaseLimit || "";
  return text && !/无限额|---/.test(text);
}

function statusTag(status) {
  const cls = /暂停|停止/.test(status) ? "stop" : /限/.test(status) ? "warn" : "";
  return `<span class="tag ${cls}">${status || "--"}</span>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fillSelect(selector, values) {
  const select = $(selector);
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  select.insertAdjacentHTML(
    "beforeend",
    options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(""),
  );
}

function renderSummary(payload) {
  $("#countAll").textContent = payload.count;
  $("#countNasdaq").textContent = state.funds.filter((fund) => fund.focus === "纳指").length;
  $("#countSp").textContent = state.funds.filter((fund) => fund.focus === "标普").length;
  $("#countEtf").textContent = state.funds.filter((fund) => fund.tradingVenue === "场内ETF").length;
  $("#countLimited").textContent = state.funds.filter(hasLimit).length;
  $("#meta").textContent = `更新：${new Date(payload.generatedAt).toLocaleString("zh-CN")}；数据日期：${payload.date}；来源：东方财富/天天基金公开数据。${payload.note}`;
}

function compareFunds(a, b) {
  const av = getValue(a, state.sortKey);
  const bv = getValue(b, state.sortKey);
  const dir = state.sortDir === "asc" ? 1 : -1;
  if (state.sortKey === "focus") {
    const order = { 纳指: 0, 标普: 1, 美国: 2, 全球: 3 };
    return ((order[av] ?? 9) - (order[bv] ?? 9) || a.code.localeCompare(b.code)) * dir;
  }
  const an = Number(String(av ?? "").replace(/[^\d.-]/g, ""));
  const bn = Number(String(bv ?? "").replace(/[^\d.-]/g, ""));
  if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
  return String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN") * dir;
}

function applyFilters() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const focus = $("#focusFilter").value;
  const currency = $("#currencyFilter").value;
  const shareClass = $("#classFilter").value;
  const venue = $("#venueFilter").value;
  const status = $("#statusFilter").value;
  const limited = $("#limitOnly").checked;

  state.filtered = state.funds
    .filter((fund) => {
      const haystack = `${fund.code} ${fund.name} ${fund.pinyin}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .filter((fund) => !focus || fund.focus === focus)
    .filter((fund) => !currency || fund.currency === currency)
    .filter((fund) => !shareClass || fund.shareClass === shareClass)
    .filter((fund) => !venue || fund.tradingVenue === venue)
    .filter((fund) => !status || fund.fees.tradingStatus.purchase === status)
    .filter((fund) => !limited || hasLimit(fund))
    .sort(compareFunds);

  renderTable();
}

function renderTable() {
  $("#resultCount").textContent = `当前显示 ${state.filtered.length} / ${state.funds.length} 只基金`;
  $("#fundRows").innerHTML = state.filtered
    .map(
      (fund) => `
        <tr>
          <td><a href="${fund.links.fund}" target="_blank" rel="noreferrer">${fund.code}</a></td>
          <td class="name-col">${escapeHtml(fund.name)}</td>
          <td><span class="tag">${escapeHtml(fund.focus)}</span></td>
          <td>${escapeHtml(fund.currency)}</td>
          <td>${escapeHtml(fund.shareClass)}</td>
          <td class="num ${percentClass(fund.returns.oneYear)}">${formatPercent(fund.returns.oneYear)}</td>
          <td class="num ${percentClass(fund.returns.threeYears)}">${formatPercent(fund.returns.threeYears)}</td>
          <td class="num ${percentClass(fund.returns.fiveYears)}">${formatPercent(fund.returns.fiveYears)}</td>
          <td class="num ${percentClass(fund.returns.tenYears)}">${formatPercent(fund.returns.tenYears)}</td>
          <td>${escapeHtml(fund.fees.amounts.dailyPurchaseLimit || "--")}</td>
          <td>${fund.limitSourceUrl ? `<a href="${fund.limitSourceUrl}" target="_blank" rel="noreferrer">${escapeHtml(fund.limitSource || "--")}</a>` : escapeHtml(fund.limitSource || "--")}</td>
          <td>${statusTag(fund.fees.tradingStatus.purchase)}</td>
          <td>${escapeHtml(fund.fees.operatingFees.management || "--")}</td>
          <td>${escapeHtml(fund.fees.operatingFees.custody || "--")}</td>
          <td>${escapeHtml(fund.fees.operatingFees.salesService || "--")}</td>
          <td><a class="detail-btn button muted" href="./detail.html?code=${fund.code}">查看</a></td>
        </tr>
      `,
    )
    .join("");
}

function bindEvents() {
  ["#searchInput", "#focusFilter", "#currencyFilter", "#classFilter", "#venueFilter", "#statusFilter", "#limitOnly"].forEach((selector) => {
    $(selector).addEventListener("input", applyFilters);
  });

  document.querySelector("thead").addEventListener("click", (event) => {
    const key = event.target.dataset.sort;
    if (!key) return;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = key.includes("returns") ? "desc" : "asc";
    }
    applyFilters();
  });

}

async function init() {
  const payload = await loadJson("./data/qdii-funds.json");
  if (!payload?.funds) throw new Error("数据文件缺少 funds 字段");
  state.funds = payload.funds;
  fillSelect("#focusFilter", state.funds.map((fund) => fund.focus));
  fillSelect("#currencyFilter", state.funds.map((fund) => fund.currency));
  fillSelect("#classFilter", state.funds.map((fund) => fund.shareClass));
  fillSelect("#venueFilter", state.funds.map((fund) => fund.tradingVenue));
  fillSelect("#statusFilter", state.funds.map((fund) => fund.fees.tradingStatus.purchase));
  renderSummary(payload);
  bindEvents();
  applyFilters();
}

init().catch((error) => {
  $("#meta").textContent = `数据读取失败：${error.message}`;
  console.error(error);
});
