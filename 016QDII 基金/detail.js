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

function rowsToList(rows) {
  if (!rows?.length) return "<li><span>--</span><strong>--</strong></li>";
  return rows
    .map((row) => `<li><span>${escapeHtml(row.condition)}</span><strong>${escapeHtml(row.rate)}</strong></li>`)
    .join("");
}

function renderDetail(fund, payload) {
  document.title = `${fund.name} - QDII 基金详情`;
  $("#detailPage").innerHTML = `
    <p class="eyebrow">${escapeHtml(fund.focus)} · ${escapeHtml(fund.tradingVenue)}</p>
    <h1 class="detail-title">${escapeHtml(fund.name)}</h1>
    <p class="detail-subtitle">${fund.code} · ${escapeHtml(fund.currency)} · ${escapeHtml(fund.shareClass)} · ${escapeHtml(fund.fundType || "")} · 净值日期 ${escapeHtml(fund.netValueDate || "--")}</p>
    <div class="detail-grid">
      <div class="detail-item"><span>近1年</span><strong class="${percentClass(fund.returns.oneYear)}">${formatPercent(fund.returns.oneYear)}</strong></div>
      <div class="detail-item"><span>近3年</span><strong class="${percentClass(fund.returns.threeYears)}">${formatPercent(fund.returns.threeYears)}</strong></div>
      <div class="detail-item"><span>近5年</span><strong class="${percentClass(fund.returns.fiveYears)}">${formatPercent(fund.returns.fiveYears)}</strong></div>
      <div class="detail-item"><span>近10年</span><strong class="${percentClass(fund.returns.tenYears)}">${formatPercent(fund.returns.tenYears)}</strong></div>
      <div class="detail-item"><span>日累计申购限额</span><strong>${escapeHtml(fund.fees.amounts.dailyPurchaseLimit || "--")}</strong></div>
      <div class="detail-item"><span>限额来源</span><strong>${fund.limitSourceUrl ? `<a href="${fund.limitSourceUrl}" target="_blank" rel="noreferrer">${escapeHtml(fund.limitSource || "--")}</a>` : escapeHtml(fund.limitSource || "--")}</strong></div>
      <div class="detail-item"><span>申购 / 赎回状态</span><strong>${escapeHtml(fund.fees.tradingStatus.purchase || "--")} / ${escapeHtml(fund.fees.tradingStatus.redemption || "--")}</strong></div>
      <div class="detail-item"><span>管理费率</span><strong>${escapeHtml(fund.fees.operatingFees.management || "--")}</strong></div>
      <div class="detail-item"><span>托管费率</span><strong>${escapeHtml(fund.fees.operatingFees.custody || "--")}</strong></div>
      <div class="detail-item"><span>销售服务费率</span><strong>${escapeHtml(fund.fees.operatingFees.salesService || "--")}</strong></div>
      <div class="detail-item"><span>平台申购费</span><strong>${escapeHtml(fund.buyFee.current || "--")}</strong></div>
    </div>

    <section class="fee-section">
      <h3>申购费率</h3>
      <ul class="fee-list">${rowsToList(fund.fees.purchaseFees)}</ul>
    </section>
    <section class="fee-section">
      <h3>赎回费率</h3>
      <ul class="fee-list">${rowsToList(fund.fees.redemptionFees)}</ul>
    </section>
    <section class="fee-section">
      <h3>认购费率</h3>
      <ul class="fee-list">${rowsToList(fund.fees.subscriptionFees)}</ul>
    </section>

    <div class="source-links">
      <a class="button" href="${fund.links.report}" target="_blank" rel="noreferrer">定期报告</a>
      <a class="button muted" href="${fund.links.fund}" target="_blank" rel="noreferrer">基金主页</a>
      <a class="button muted" href="${fund.links.fees}" target="_blank" rel="noreferrer">费率详情</a>
      <a class="button muted" href="${fund.links.archives}" target="_blank" rel="noreferrer">基金档案</a>
    </div>

    <p class="detail-note">数据更新：${new Date(payload.generatedAt).toLocaleString("zh-CN")}。${escapeHtml(payload.note)}</p>
  `;
}

async function init() {
  const code = new URLSearchParams(location.search).get("code");
  const payload = await loadJson("./data/qdii-funds.json");
  if (!payload?.funds) throw new Error("数据文件缺少 funds 字段");
  const fund = payload.funds.find((item) => item.code === code);
  if (!fund) {
    $("#detailPage").innerHTML = `<p class="meta">没有找到代码 ${escapeHtml(code || "")} 对应的基金。</p>`;
    return;
  }
  renderDetail(fund, payload);
}

init().catch((error) => {
  $("#detailPage").innerHTML = `<p class="meta">详情读取失败：${escapeHtml(error.message)}</p>`;
  console.error(error);
});
