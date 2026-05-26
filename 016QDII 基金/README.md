# 美国 / 全球市场 QDII 基金看板

本项目是一个本地静态网站，用于查看中国大陆可见的美国 / 全球市场 QDII 基金数据，重点覆盖纳指、标普、美国宽基/主动美股和全球权益主题。

## 使用

```bash
python3 -m http.server 4173
```

然后打开：

```text
http://127.0.0.1:4173/index.html
```

## 数据

- 主数据：东方财富 / 天天基金公开数据
- 限额核验：天天基金 F10 基本概况、F10 购买信息；广发基金优先使用广发基金官网直销限额接口
- 限额审计结果：`data/limit-audit.csv`

## 更新数据

```bash
node scripts/fetch_qdii_data.mjs
node scripts/audit_limits.mjs
```
