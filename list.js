const state = {
  funds: [],
  filtered: [],
  sortKey: "returns.oneYear",
  sortDirection: "desc",
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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getValue(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Number(value).toFixed(2)}%`;
}

function percentClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value >= 0 ? "positive" : "negative";
}

function hasLimit(fund) {
  const text = fund.fees?.amounts?.dailyPurchaseLimit || "";
  return text && !/无限额|---|^--$/.test(text);
}

function statusClass(status = "") {
  if (/暂停|停止|封闭/.test(status)) return "stop";
  if (/限/.test(status)) return "warn";
  return "open";
}

function focusOrder(focus) {
  const order = { 纳指: 0, 标普: 1, 美国: 2, 全球: 3, 港股: 4, 商品: 5, 黄金: 6, REIT: 7, 其他: 99 };
  return order[focus] ?? 50;
}

function fillSelect(selector, values, sorter = undefined) {
  const select = $(selector);
  const options = [...new Set(values.filter(Boolean))].sort(sorter || ((a, b) => a.localeCompare(b, "zh-CN")));
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

function normalizeForSort(value, key) {
  if (value === null || value === undefined || value === "") return key.startsWith("returns.") ? -Infinity : "";
  if (typeof value === "number") return value;
  const numeric = Number(String(value).replace(/[,%元美元人民币每年（）()]/g, ""));
  if (Number.isFinite(numeric) && /returns|Limit|fee|amount/i.test(key)) return numeric;
  return String(value);
}

function compareFunds(a, b) {
  const av = normalizeForSort(getValue(a, state.sortKey), state.sortKey);
  const bv = normalizeForSort(getValue(b, state.sortKey), state.sortKey);
  let result = 0;

  if (state.sortKey === "focus") {
    result = focusOrder(av) - focusOrder(bv);
  } else if (typeof av === "number" && typeof bv === "number") {
    result = av - bv;
  } else {
    result = String(av).localeCompare(String(bv), "zh-CN", { numeric: true });
  }

  if (result === 0) result = a.code.localeCompare(b.code);
  return state.sortDirection === "asc" ? result : -result;
}

function applyFilters() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const focus = $("#focusFilter").value;
  const currency = $("#currencyFilter").value;
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
    .filter((fund) => !venue || fund.tradingVenue === venue)
    .filter((fund) => !status || fund.fees?.tradingStatus?.purchase === status)
    .filter((fund) => !limited || hasLimit(fund))
    .sort(compareFunds);

  renderRows();
}

function renderRows() {
  $("#resultCount").textContent = `当前显示 ${state.filtered.length} / ${state.funds.length} 只基金`;

  if (!state.filtered.length) {
    $("#fundRows").innerHTML = `<tr><td colspan="16">没有找到符合条件的基金。</td></tr>`;
    return;
  }

  $("#fundRows").innerHTML = state.filtered
    .map((fund) => {
      const limit = fund.fees?.amounts?.dailyPurchaseLimit || "--";
      const purchaseStatus = fund.fees?.tradingStatus?.purchase || "--";
      const fees = fund.fees?.operatingFees || {};
      const source = fund.limitSourceUrl
        ? `<a href="${escapeHtml(fund.limitSourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(fund.limitSource || "费率页")}</a>`
        : escapeHtml(fund.limitSource || "--");

      return `<tr>
        <td><a class="code-link" href="${escapeHtml(fund.links?.fund || "#")}" target="_blank" rel="noreferrer">${escapeHtml(fund.code)}</a></td>
        <td class="name-col"><strong>${escapeHtml(fund.name)}</strong><small>${escapeHtml(fund.fundType || "--")}</small></td>
        <td><span class="tag">${escapeHtml(fund.focus || "其他")}</span></td>
        <td>${escapeHtml(fund.currency || "--")}</td>
        <td>${escapeHtml(fund.shareClass || "--")}</td>
        <td class="num ${percentClass(fund.returns?.oneYear)}">${formatPercent(fund.returns?.oneYear)}</td>
        <td class="num ${percentClass(fund.returns?.threeYears)}">${formatPercent(fund.returns?.threeYears)}</td>
        <td class="num ${percentClass(fund.returns?.fiveYears)}">${formatPercent(fund.returns?.fiveYears)}</td>
        <td class="num ${percentClass(fund.returns?.tenYears)}">${formatPercent(fund.returns?.tenYears)}</td>
        <td>${escapeHtml(limit)}</td>
        <td>${source}</td>
        <td><span class="status ${statusClass(purchaseStatus)}">${escapeHtml(purchaseStatus)}</span></td>
        <td>${escapeHtml(fees.management || "--")}</td>
        <td>${escapeHtml(fees.custody || "--")}</td>
        <td>${escapeHtml(fees.salesService || "--")}</td>
        <td><a class="detail-btn" href="./detail.html?code=${encodeURIComponent(fund.code)}">详情</a></td>
      </tr>`;
    })
    .join("");
}

function bindEvents() {
  ["#searchInput", "#focusFilter", "#currencyFilter", "#venueFilter", "#statusFilter", "#limitOnly"].forEach((selector) => {
    $(selector).addEventListener("input", applyFilters);
  });

  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection = key.startsWith("returns.") ? "desc" : "asc";
      }
      applyFilters();
    });
  });
}

async function init() {
  const payload = await loadJson("./data/qdii-funds.json");
  if (!payload?.funds) throw new Error("数据文件缺少 funds 字段");
  state.funds = payload.funds;
  fillSelect("#focusFilter", state.funds.map((fund) => fund.focus), (a, b) => focusOrder(a) - focusOrder(b) || a.localeCompare(b, "zh-CN"));
  fillSelect("#currencyFilter", state.funds.map((fund) => fund.currency));
  fillSelect("#venueFilter", state.funds.map((fund) => fund.tradingVenue));
  fillSelect("#statusFilter", state.funds.map((fund) => fund.fees?.tradingStatus?.purchase));
  renderSummary(payload);
  bindEvents();
  applyFilters();
}

init().catch((error) => {
  $("#meta").textContent = `数据读取失败：${error.message}`;
  $("#fundRows").innerHTML = `<tr><td colspan="16">数据读取失败：${escapeHtml(error.message)}</td></tr>`;
  console.error(error);
});
