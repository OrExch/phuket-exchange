const fs = require("fs");
const path = require("path");

const MARKUP = process.env.MARKUP !== undefined ? Number(process.env.MARKUP) : 0;
const LOCAL_CURRENCIES = (process.env.CURRENCIES || "THB,AED").split(",").map((c) => c.trim());
const OUTPUT = path.join(__dirname, "..", "rate.js");

function parseGoogleRate(html, quote) {
  const embedded = html.match(new RegExp(`"USD \\/ ${quote}",\\d+,null,\\[([\\d.]+)`));
  if (embedded) return Number(embedded[1]);

  const visible = html.match(/United States Dollar \/ [A-Za-z ]+<\/div>[\s\S]{0,400}?<span>([\d,.]+)<\/span>/);
  if (visible) return Number(visible[1].replace(/,/g, ""));

  throw new Error(`Курс USD/${quote} не найден на странице Google Finance`);
}

async function fetchUsdRate(quote) {
  const res = await fetch(`https://www.google.com/finance/quote/USD-${quote}?hl=en`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "CONSENT=YES+",
    },
  });
  if (!res.ok) throw new Error(`Google Finance (USD/${quote}) ответил ${res.status}`);
  const rate = parseGoogleRate(await res.text(), quote);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Некорректный курс USD/${quote}: ${rate}`);
  return rate;
}

const round = (n) => +n.toFixed(4);

// При MARKUP > 0 наценка идёт в пользу сервиса: клиент получает меньше и платит больше рыночного курса.
function withMarkup(usdLocal, usdRub) {
  const rubPerLocal = usdRub / usdLocal;
  return {
    usdtToLocal: round(usdLocal * (1 - MARKUP)), // местной валюты за 1 USDT, клиент отдаёт USDT
    localToUsdt: round(usdLocal * (1 + MARKUP)), // местной валюты за 1 USDT, клиент покупает USDT
    rubToLocal: round(rubPerLocal * (1 + MARKUP)), // рублей за 1 ед. местной валюты, клиент отдаёт рубли
    localToRub: round(rubPerLocal * (1 - MARKUP)), // рублей за 1 ед. местной валюты, клиент получает рубли
  };
}

async function main() {
  const usdRub = await fetchUsdRate("RUB");
  const data = { updatedAt: new Date().toISOString() };
  for (const cur of LOCAL_CURRENCIES) {
    const usdLocal = await fetchUsdRate(cur);
    data[cur] = withMarkup(usdLocal, usdRub);
    console.log(`USD/${cur} ${usdLocal}, USD/RUB ${usdRub} →`, data[cur]);
  }
  fs.writeFileSync(OUTPUT, `window.RATE = ${JSON.stringify(data)};\n`);
  console.log(`Наценка ${MARKUP * 100}%, записано в rate.js`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
