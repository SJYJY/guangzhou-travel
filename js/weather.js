// 天气模块：Open-Meteo 免费接口（无需 key），广州 10 天预报 + 穿衣/出行建议
(function () {
  const WMO = {
    0: ["晴", "☀️"], 1: ["晴间多云", "🌤️"], 2: ["多云", "⛅"], 3: ["阴", "☁️"], 45: ["雾", "🌫️"], 48: ["雾", "🌫️"],
    51: ["毛毛雨", "🌦️"], 53: ["毛毛雨", "🌦️"], 55: ["毛毛雨", "🌧️"], 56: ["冻毛毛雨", "🌧️"], 57: ["冻毛毛雨", "🌧️"],
    61: ["小雨", "🌦️"], 63: ["中雨", "🌧️"], 65: ["大雨", "🌧️"], 66: ["冻雨", "🌧️"], 67: ["冻雨", "🌧️"],
    71: ["小雪", "🌨️"], 73: ["中雪", "🌨️"], 75: ["大雪", "❄️"], 77: ["雪粒", "🌨️"],
    80: ["阵雨", "🌦️"], 81: ["阵雨", "🌧️"], 82: ["强阵雨", "⛈️"], 85: ["阵雪", "🌨️"], 86: ["阵雪", "🌨️"],
    95: ["雷阵雨", "⛈️"], 96: ["雷阵雨伴冰雹", "⛈️"], 99: ["强雷阵雨伴冰雹", "⛈️"]
  };
  const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const KEY = "gz_weather_v1";
  const API = "https://api.open-meteo.com/v1/forecast?latitude=23.13&longitude=113.27&timezone=Asia%2FShanghai&forecast_days=10"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max,relative_humidity_2m_mean,sunrise,sunset"
    + "&hourly=temperature_2m,precipitation_probability,weather_code"
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m";

  async function getForecast(force) {
    let cache = null; try { cache = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!force && cache && Date.now() - cache.t < 3600e3) return { ...cache.data, _time: cache.t };
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
      const data = await (await fetch(API, { signal: ctrl.signal })).json(); clearTimeout(tm);
      if (!data.daily) throw new Error("bad data");
      try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
      return { ...data, _time: Date.now() };
    } catch (e) {
      if (cache) return { ...cache.data, _time: cache.t, _stale: true };
      throw e;
    }
  }
  function wmo(code) { return WMO[code] || ["未知", "🌡️"]; }
  function days(data) {
    const d = data.daily;
    return d.time.map((t, i) => {
      const dt = new Date(t + "T12:00:00Z"), [text, icon] = wmo(d.weather_code[i]);
      const hrs = data.hourly ? data.hourly.time.map((h, k) => k).filter(k => data.hourly.time[k].startsWith(t)) : [];
      return {
        date: t, md: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, wd: i === 0 ? "今天" : i === 1 ? "明天" : WD[dt.getUTCDay()], week: WD[dt.getUTCDay()],
        code: d.weather_code[i], text, icon,
        tmax: Math.round(d.temperature_2m_max[i]), tmin: Math.round(d.temperature_2m_min[i]),
        amax: Math.round(d.apparent_temperature_max[i]), amin: Math.round(d.apparent_temperature_min[i]),
        rain: d.precipitation_probability_max[i] ?? 0, mm: d.precipitation_sum[i] ?? 0, uv: d.uv_index_max[i] ?? 0,
        wind: Math.round(d.wind_speed_10m_max[i] ?? 0), hum: Math.round(d.relative_humidity_2m_mean[i] ?? 0),
        sunrise: (d.sunrise[i] || "").slice(11), sunset: (d.sunset[i] || "").slice(11),
        hourly: hrs.map(k => ({ h: data.hourly.time[k].slice(11, 13), t: data.hourly.temperature_2m[k], p: data.hourly.precipitation_probability[k], c: data.hourly.weather_code[k] }))
      };
    });
  }
  function isRainy(d) { return d.rain >= 60 || d.mm >= 5 || d.code >= 80 || (d.code >= 61 && d.code <= 67); }

  // 穿衣建议：以白天体感为主
  function clothing(d) {
    const feel = d.amax * 0.6 + d.amin * 0.4;
    let level, wear;
    if (feel >= 32) { level = "炎热"; wear = "短袖 / 背心 + 短裤或裙子，选浅色透气、速干面料"; }
    else if (feel >= 27) { level = "热"; wear = "短袖 + 薄长裤 / 短裤，透气凉鞋或运动鞋"; }
    else if (feel >= 23) { level = "温暖"; wear = "短袖或薄长袖，早晚加一件薄外套 / 衬衫"; }
    else if (feel >= 19) { level = "舒适"; wear = "长袖 T 恤 / 衬衫 + 薄外套，长裤"; }
    else if (feel >= 15) { level = "微凉"; wear = "卫衣 / 针织衫 + 夹克或风衣"; }
    else if (feel >= 10) { level = "凉"; wear = "毛衣 + 厚外套，室外有风会冷"; }
    else { level = "冷"; wear = "厚毛衣 + 羽绒服 / 棉服（广州室内一般没有暖气）"; }
    const items = [];
    if (d.rain >= 50 || d.mm >= 3) items.push("☂️ 雨伞必带，穿防水 / 速干鞋");
    else if (d.rain >= 25) items.push("☂️ 包里放把折叠伞");
    if (d.uv >= 6) items.push("🧴 紫外线强：防晒霜 SPF50 + 遮阳帽 + 墨镜");
    else if (d.uv >= 3) items.push("🧴 涂防晒霜");
    if (d.tmax - d.tmin >= 8) items.push("🧅 早晚温差大，洋葱式穿搭方便增减");
    if (d.tmax >= 26) items.push("🧥 商场、地铁空调很足，备一件薄外套");
    if (d.hum >= 80) items.push("💦 很潮湿，选速干透气衣物，多带一套替换");
    if (d.wind >= 30) items.push("🌬️ 风较大，带防风外套");
    if (d.amax >= 32) items.push("💧 多补水，中午尽量待在室内");
    return { level, wear, items };
  }
  // 出行建议
  function activity(d) {
    if (d.code >= 95) return "⛈️ 有雷雨：尽量安排室内（广东省博物馆、南越王博物院、天河路商场、饮早茶），避免珠江夜游和登高。";
    if (isRainy(d)) return "🌧️ 雨天：优先室内景点——博物馆、陈家祠、商场、茶楼；骑楼街（上下九、北京路）有廊可以避雨。";
    if (d.amax >= 34) return "🥵 高温：上午、傍晚户外，中午去博物馆或商场；晚上适合珠江夜游、广州塔。";
    if (d.code <= 2 && d.rain < 30) return "😎 好天气：适合沙面、东山口、越秀公园等户外 citywalk，傍晚登广州塔看日落。";
    return "🙂 适合正常游玩，带把伞以防万一。";
  }
  // 适合出游程度 0-100
  function score(d) {
    let s = 100;
    s -= Math.max(0, d.rain - 20) * 0.8;
    if (d.code >= 95) s -= 25;
    else if (d.code >= 51) s -= 12;      // 有降水
    else if (d.code === 3) s -= 4;       // 阴天
    if (d.tmax > 28) s -= (d.tmax - 28) * 3;
    if (d.tmax < 18) s -= (18 - d.tmax) * 3;
    if (d.amax > 32) s -= (d.amax - 32) * 4;
    if (d.amin < 10) s -= (10 - d.amin) * 4;
    if (d.hum > 85) s -= 8;
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  window.GZW = { getForecast, days, clothing, activity, score, isRainy, wmo };
})();
