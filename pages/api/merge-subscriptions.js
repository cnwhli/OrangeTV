// api/merge-subscriptions.js
import fetch from "node-fetch";

/**
 * 统一订阅解析：兼容 OrangeTV 配置 和 TVBox/影视仓订阅
 */
function normalizeConfig(config) {
  const api_site = {};
  const parse_site = {};
  const live_site = {};

  // 1. OrangeTV 格式
  if (config.api_site) {
    Object.assign(api_site, config.api_site);
  }

  // 2. TVBox/影视仓格式
  if (Array.isArray(config.sites)) {
    config.sites.forEach(site => {
      if (site.api) {
        const key = (site.key || site.name || site.api)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (!api_site[key]) {
          api_site[key] = {
            api: site.api,
            name: site.name || key,
            detail: site.ext || "",
            type: site.type || 3,
            searchable: site.searchable ?? true,
            quickSearch: site.quickSearch ?? true,
            filterable: site.filterable ?? true
          };
        }
      }
    });
  }

  if (Array.isArray(config.parses)) {
    config.parses.forEach(parse => {
      if (parse.url) {
        const key = (parse.name || parse.url)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (!parse_site[key]) {
          parse_site[key] = {
            name: parse.name || key,
            url: parse.url,
            type: parse.type || 0,
            header: parse.header || {}
          };
        }
      }
    });
  }

  if (Array.isArray(config.lives)) {
    config.lives.forEach((live, idx) => {
      if (live.url) {
        const key = live.name || `live${idx}`;
        if (!live_site[key]) {
          live_site[key] = {
            name: live.name || key,
            url: live.url,
            type: live.type || 0,
            epg: live.epg || "",
            logo: live.logo || ""
          };
        }
      }
    });
  }

  return { api_site, parse_site, live_site };
}

/**
 * 健康检查：尝试请求 API，判断是否可用
 */
async function checkHealth(api) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(api, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok ? "ok" : `fail(${res.status})`;
  } catch {
    return "fail";
  }
}

export default async function handler(req, res) {
  try {
    const { urls } = req.query; // 多个订阅地址用逗号分隔
    if (!urls) return res.status(400).json({ error: "缺少订阅地址" });

    const urlList = urls.split(",");
    let merged = { api_site: {}, parse_site: {}, live_site: {} };

    for (const url of urlList) {
      try {
        const resp = await fetch(url.trim());
        const data = await resp.json();
        const normalized = normalizeConfig(data);

        merged.api_site = { ...merged.api_site, ...normalized.api_site };
        merged.parse_site = { ...merged.parse_site, ...normalized.parse_site };
        merged.live_site = { ...merged.live_site, ...normalized.live_site };
      } catch (err) {
        console.warn(`⚠️ 订阅导入失败: ${url}`, err.message);
      }
    }

    // 健康检查
    const keys = Object.keys(merged.api_site);
    await Promise.all(
      keys.map(async key => {
        const status = await checkHealth(merged.api_site[key].api);
        merged.api_site[key].healthy = status;
      })
    );

    const finalConfig = {
      cache_time: 7200,
      api_site: merged.api_site,
      parse_site: merged.parse_site,
      live_site: merged.live_site,
      custom_category: []
    };

    res.json(finalConfig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
