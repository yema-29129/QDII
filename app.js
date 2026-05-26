const state = {
  funds: [],
  filtered: [],
  activeFocus: "",
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

function getCategoryCounts() {
  const counts = new Map();
  state.funds.forEach((fund) => {
    const key = fund.focus || "其他";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => focusOrder(a[0]) - focusOrder(b[0]) || a[0].localeCompare(b[0], "zh-CN"));
}

function renderCategories() {
  const categories = [["", "全部", state.funds.length], ...getCategoryCounts().map(([name, count]) => [name, name, count])];
  $("#categoryList").innerHTML = categories
    .map(([value, label, count]) => {
      const active = state.activeFocus === value ? "active" : "";
      return `<button class="category-btn ${active}" type="button" data-focus="${escapeHtml(value)}">
        <span>${escapeHtml(label)}</span>
        <strong>${count}</strong>
      </button>`;
    })
    .join("");
}

function sortCards(a, b) {
  const focusDiff = focusOrder(a.focus) - focusOrder(b.focus);
  if (focusDiff !== 0) return focusDiff;
  const ar = Number(a.returns?.oneYear ?? -9999);
  const br = Number(b.returns?.oneYear ?? -9999);
  if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return br - ar;
  return a.code.localeCompare(b.code);
}

function applyFilters() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const currency = $("#currencyFilter").value;
  const status = $("#statusFilter").value;
  const limited = $("#limitOnly").checked;

  state.filtered = state.funds
    .filter((fund) => {
      const haystack = `${fund.code} ${fund.name} ${fund.pinyin}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .filter((fund) => !state.activeFocus || fund.focus === state.activeFocus)
    .filter((fund) => !currency || fund.currency === currency)
    .filter((fund) => !status || fund.fees.tradingStatus.purchase === status)
    .filter((fund) => !limited || hasLimit(fund))
    .sort(sortCards);

  renderCategories();
  renderCards();
}

function renderCards() {
  const title = state.activeFocus ? `${state.activeFocus}相关基金` : "全部基金";
  $("#activeCategoryTitle").textContent = title;
  $("#resultCount").textContent = `当前显示 ${state.filtered.length} / ${state.funds.length} 只基金`;

  if (!state.filtered.length) {
    $("#fundCards").innerHTML = `<div class="empty-card">没有找到符合条件的基金，换一个分类或关键词试试。</div>`;
    return;
  }

  $("#fundCards").innerHTML = state.filtered
    .map((fund) => {
      const purchaseStatus = fund.fees?.tradingStatus?.purchase || "--";
      const limit = fund.fees?.amounts?.dailyPurchaseLimit || "--";
      return `<a class="fund-card" href="./detail.html?code=${encodeURIComponent(fund.code)}" aria-label="查看 ${escapeHtml(fund.name)} 详情">
        <div class="card-topline">
          <span class="code">${escapeHtml(fund.code)}</span>
          <span class="pill">${escapeHtml(fund.focus || "其他")}</span>
          <span class="pill light">${escapeHtml(fund.currency || "--")}</span>
          <span class="status ${statusClass(purchaseStatus)}">${escapeHtml(purchaseStatus)}</span>
        </div>
        <h2>${escapeHtml(fund.name)}</h2>
        <div class="card-metrics">
          <div>
            <span>近一年</span>
            <strong class="${percentClass(fund.returns?.oneYear)}">${formatPercent(fund.returns?.oneYear)}</strong>
          </div>
          <div>
            <span>限购金额</span>
            <strong>${escapeHtml(limit)}</strong>
          </div>
        </div>
        <div class="card-foot">
          <span>${escapeHtml(fund.tradingVenue || "--")} · ${escapeHtml(fund.shareClass || "--")}</span>
          <em>查看详情 →</em>
        </div>
      </a>`;
    })
    .join("");
}

function bindEvents() {
  ["#searchInput", "#currencyFilter", "#statusFilter", "#limitOnly"].forEach((selector) => {
    $(selector).addEventListener("input", applyFilters);
  });

  $("#categoryList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-focus]");
    if (!button) return;
    state.activeFocus = button.dataset.focus;
    applyFilters();
  });
}

async function init() {
  const payload = await loadJson("./data/qdii-funds.json");
  if (!payload?.funds) throw new Error("数据文件缺少 funds 字段");
  state.funds = payload.funds;
  fillSelect("#currencyFilter", state.funds.map((fund) => fund.currency));
  fillSelect("#statusFilter", state.funds.map((fund) => fund.fees.tradingStatus.purchase));
  renderSummary(payload);
  bindEvents();
  applyFilters();
}

init().catch((error) => {
  $("#meta").textContent = `数据读取失败：${error.message}`;
  console.error(error);
});
