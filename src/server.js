const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const host = "127.0.0.1";
const port = Number(process.env.PORT) || 3001;
const publicDirectory = path.join(__dirname, "..", "public");
const pagePath = path.join(publicDirectory, "index.html");
const backgroundPath = path.join(publicDirectory, "radio-kevin-background.jpg");
const apiHost = "https://de1.api.radio-browser.info";
const cache = new Map();
const cacheDuration = 5 * 60 * 1000;
const supportedCountryCodes = new Set([
  "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES",
  "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV",
  "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SK",
  "UA", "VA", "XK", "GE", "TR", "AZ",
]);

async function getRadioData(pathname) {
  const cached = cache.get(pathname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const upstream = await fetch(`${apiHost}${pathname}`, {
    headers: { "User-Agent": "RadioKevin/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!upstream.ok) {
    throw new Error(`Radio Browser API повернув HTTP ${upstream.status}`);
  }

  const data = await upstream.json();
  cache.set(pathname, { data, expiresAt: Date.now() + cacheDuration });
  return data;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Маршрут не знайдено");
    return;
  }

  const requestUrl = new URL(request.url, `http://${host}:${port}`);

  if (requestUrl.pathname === "/radio-kevin-background.jpg") {
    try {
      const image = await readFile(backgroundPath);
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      });
      response.end(image);
    } catch (error) {
      console.error("Не вдалося завантажити фонове зображення:", error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Не вдалося завантажити фонове зображення");
    }
    return;
  }

  if (requestUrl.pathname === "/api/countries") {
    try {
      const allCountries = await getRadioData("/json/countries?order=stationcount&reverse=true");
      const countries = allCountries
        .filter((country) => supportedCountryCodes.has(country.iso_3166_1) && country.stationcount > 0)
        .map(({ name, iso_3166_1, stationcount }) => ({ name, iso_3166_1, stationcount }));
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      response.end(JSON.stringify(countries));
    } catch (error) {
      console.error("Не вдалося завантажити список країн:", error);
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Не вдалося завантажити список країн. Спробуйте ще раз." }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/stations") {
    const countryCode = requestUrl.searchParams.get("countrycode")?.toUpperCase();
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Вкажіть правильний дволітерний код країни." }));
      return;
    }
    if (!supportedCountryCodes.has(countryCode)) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Ця країна не входить до каталогу Radio Kevin." }));
      return;
    }

    try {
      const pathname =
        `/json/stations/bycountrycodeexact/${countryCode}` +
        "?limit=24&order=clickcount&reverse=true&hidebroken=true";
      const allStations = await getRadioData(pathname);
      const stations = allStations.map(
        ({ stationuuid, name, url, url_resolved, favicon, tags, language, country, countrycode }) => ({
          stationuuid,
          name,
          url,
          url_resolved,
          favicon,
          tags,
          language,
          country,
          countrycode,
        }),
      );
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      response.end(JSON.stringify(stations));
    } catch (error) {
      console.error(`Не вдалося завантажити радіостанції (${countryCode}):`, error);
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Не вдалося завантажити радіостанції. Спробуйте ще раз." }));
    }
    return;
  }

  if (requestUrl.pathname !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Сторінку не знайдено");
    return;
  }

  try {
    const page = await readFile(pagePath);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
  } catch (error) {
    console.error("Не вдалося завантажити стартову сторінку:", error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Помилка сервера");
  }
});

server.listen(port, host, () => {
  console.log(`Radio Kevin запущено: http://localhost:${port}`);
});

server.on("error", (error) => {
  console.error("Не вдалося запустити сервер:", error);
  process.exitCode = 1;
});
