#!/usr/bin/env node
// Prüft index.html im Browser gegen nachgestellte Dienste (GitHub, Spotify).
// Aufruf: node tests/seite_test.js [Ordner für Bilder]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WURZEL = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
const BILDER = process.argv[2] || '';
let fehler = 0;
function pruefe(wahr, text) {
  console.log((wahr ? 'ok    ' : 'FEHLER ') + text);
  if (!wahr) fehler++;
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset' };
const warte = ms => new Promise(r => setTimeout(r, ms));
async function bisZu(bedingung, ms = 8000, text = '') {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await bedingung()) return true; await warte(40); }
  if (text) console.log('  (Zeit abgelaufen: ' + text + ')');
  return false;
}

// Liefert die Seite, wie GitHub Pages sie liefern würde.
const server = http.createServer((q, a) => {
  const pfad = q.url.split('?')[0];
  if (pfad === '/wegwart-klang/' || pfad === '/wegwart-klang/index.html') { a.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); a.end(HTML); } else { a.writeHead(404); a.end(); }
});

function b64(o) { return Buffer.from(JSON.stringify(o), 'utf8').toString('base64'); }

// Nachgestellte Dienste je Testfall.
async function dienste(context, { signal, ratelimit = { limit: 5000, remaining: 4999, resetIn: 3600 }, player }) {
  const log = { github: 0, github304: 0, spotify: [], token: [], authorize: [], fremd: [] };
  const zustand = { signal, version: 1, ratelimit, player };
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://open.spotify.com/**', r => { log.fremd.push(r.request().url()); return r.abort(); });
  await context.route('https://api.github.com/**', async r => {
    log.github++;
    const etag = '"v' + zustand.version + '"';
    const rl = zustand.ratelimit;
    const kopf = { ...CORS, ETag: etag, 'X-RateLimit-Limit': String(rl.limit), 'X-RateLimit-Remaining': String(rl.remaining), 'X-RateLimit-Reset': String(rl.resetAt || Math.floor(Date.now() / 1000) + rl.resetIn) };
    if (rl.limit <= 60) rl.remaining = Math.max(0, rl.remaining - 1);
    if (r.request().headers()['if-none-match'] === etag) { log.github304++; return r.fulfill({ status: 304, headers: kopf }); }
    return r.fulfill({ status: 200, headers: { ...kopf, 'content-type': 'application/json' }, body: JSON.stringify({ content: b64(zustand.signal) }) });
  });
  await context.route('https://accounts.spotify.com/authorize**', r => {
    const u = new URL(r.request().url());
    log.authorize.push(u);
    const zurueck = u.searchParams.get('redirect_uri') + '?code=CODE123&state=' + u.searchParams.get('state');
    return r.fulfill({ status: 302, headers: { location: zurueck } });
  });
  await context.route('https://accounts.spotify.com/api/token', r => {
    const form = new URLSearchParams(r.request().postData());
    log.token.push(form);
    const sag = zustand.tokenAntwort ? zustand.tokenAntwort(form) : { status: 200, body: { access_token: 'ZUGRIFF', refresh_token: 'ERNEUERN', expires_in: 3600 } };
    return r.fulfill({ status: sag.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(sag.body) });
  });
  await context.route('https://api.spotify.com/**', async r => {
    const q = r.request();
    const u = new URL(q.url());
    const p = u.pathname.replace('/v1', '');
    const eintrag = { m: q.method(), p, q: u.search, b: q.postData() ? JSON.parse(q.postData()) : null };
    log.spotify.push(eintrag);
    const kopf = { ...CORS, 'content-type': 'application/json' };
    const pl = zustand.player;
    if (q.method() === 'GET' && p === '/me/player') {
      if (!pl.aktiv) return r.fulfill({ status: 204, headers: CORS });
      return r.fulfill({ status: 200, headers: kopf, body: JSON.stringify({ is_playing: pl.spielt, context: pl.ctx ? { uri: pl.ctx } : null, device: { id: 'g1', name: 'Pixel', volume_percent: pl.vol, supports_volume: pl.stellbar !== false }, item: { name: 'Titel', artists: [{ name: 'Wer' }] } }) });
    }
    if (q.method() === 'GET' && p === '/me/player/devices') return r.fulfill({ status: 200, headers: kopf, body: JSON.stringify({ devices: pl.geraete || [] }) });
    if (q.method() === 'PUT' && p === '/me/player/volume') { pl.vol = +u.searchParams.get('volume_percent'); pl.volLog = (pl.volLog || []).concat(pl.vol); return r.fulfill({ status: 204, headers: CORS }); }
    if (q.method() === 'PUT' && p === '/me/player/shuffle') return r.fulfill({ status: 204, headers: CORS });
    if (q.method() === 'PUT' && p === '/me/player') { pl.aktiv = true; return r.fulfill({ status: 204, headers: CORS }); }
    if (q.method() === 'PUT' && p === '/me/player/play') {
      if (pl.playFehler && pl.playFehler.length) { const f = pl.playFehler.shift(); return r.fulfill({ status: f.status, headers: kopf, body: JSON.stringify({ error: f }) }); }
      if (pl.playDauer) await warte(pl.playDauer);
      pl.ctx = eintrag.b.context_uri; pl.spielt = true; pl.aktiv = true;
      return r.fulfill({ status: 204, headers: CORS });
    }
    return r.fulfill({ status: 404, headers: kopf, body: '{"error":{"status":404,"message":"?"}}' });
  });
  return { log, zustand };
}

const SIGNAL = (ort, nr = 1) => ({ ort, ortname: 'Ort ' + nr, hinweis: 'Hinweis ' + nr, gesetzt: '2026-11-04T10:00:0' + nr + 'Z' });
const URI = { wald: 'spotify:playlist:602nYr5A65NHe1vjKP3yWf', sumpf: 'spotify:playlist:55Rbwla0LxYEeokLQdc2HR', dorf: 'spotify:playlist:2v5wdl16NZyXphIcRgElhY', nacht: 'spotify:playlist:6vdRpIUlczZz9Af3pdPzXi' };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const SEITE = 'http://127.0.0.1:' + server.address().port + '/wegwart-klang/';
  const browser = await chromium.launch();
  const einstellen = (context, cfg) => context.addInitScript(c => { if (!sessionStorage.getItem('test.gesetzt')) { sessionStorage.setItem('test.gesetzt', '1'); localStorage.setItem('klangtisch.cfg', JSON.stringify(c)); } }, cfg);
  const CFG = { clientId: 'KENNUNG' };

  // ---------- A: Automatik ist der Regelfall und braucht auf der Seite keine Anmeldung ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', permissions: ['clipboard-read', 'clipboard-write'] });
    await einstellen(context, CFG);
    const { log } = await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    const js = []; page.on('pageerror', e => js.push(e.message));
    await page.goto(SEITE);
    await page.waitForFunction(() => document.getElementById('now-name').textContent === 'Wald und Hain');
    pruefe(await page.locator('#open-now').isVisible(), 'A: Knopf „In Spotify öffnen“ sichtbar');
    pruefe((await page.locator('#open-now').getAttribute('href')).endsWith('602nYr5A65NHe1vjKP3yWf'), 'A: Knopf zeigt auf die Playlist des Ortes');
    pruefe(!(await page.locator('#start').isVisible()), 'A: kein Start- und kein Verbinden-Knopf');
    pruefe(!(await page.locator('#setup').isVisible()), 'A: mit Client-ID keine Karte „Spotify-App anlegen“');
    pruefe(await page.locator('a.ort-play:visible').count() === 9 && await page.locator('button.ort-play:visible').count() === 0, 'A: Liste mit neun Öffnen-Verweisen');
    pruefe(await page.locator('.ort.active .ort-name').textContent() === 'Wald und Hain', 'A: Ort in der Liste markiert');
    pruefe((await page.locator('#now-eyebrow').textContent()) === 'Ort 1', 'A: Ortsname aus dem Signal');
    pruefe(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'A: am Handy kein waagrechtes Scrollen');
    await warte(300);
    pruefe(log.spotify.length === 0 && log.authorize.length === 0, 'A: keine Anfrage an Spotify');
    pruefe(log.fremd.length === 0, 'A: Player-Skript von Spotify nicht geladen');
    pruefe(js.length === 0, 'A: keine Skriptfehler ' + js.join(' | '));
    if (BILDER) await page.screenshot({ path: path.join(BILDER, 'auto-hell.png'), fullPage: true });
    await context.close();
  }

  // ---------- A1: ohne jede Einstellung ist die Client-ID schon da ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    await page.goto(SEITE);
    await page.waitForFunction(() => document.getElementById('now-name').textContent === 'Wald und Hain');
    pruefe(!(await page.locator('#setup').isVisible()), 'A1: frischer Browser braucht keine Client-ID');
    await context.close();
  }

  // ---------- A2: ohne Client-ID (eigener Fork) wird die Einrichtung angezeigt ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    await page.route(SEITE, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML.replace(/clientId:'\w+',deviceId/, "clientId:'',deviceId") }));
    await page.goto(SEITE);
    await page.waitForFunction(() => document.getElementById('now-name').textContent === 'Wald und Hain');
    pruefe(await page.locator('#setup').isVisible(), 'A2: ohne Client-ID Karte „Spotify-App anlegen“');
    pruefe((await page.locator('#redirect-uri').textContent()) === SEITE, 'A2: Redirect URI mit Schrägstrich');
    await page.locator('#auto summary').click();
    await page.locator('#auto-consent').click();
    pruefe(await page.locator('#settings').evaluate(d => d.open), 'A2: Zustimmen ohne Client-ID führt zu den Einstellungen');
    await context.close();
  }

  // ---------- B: Schlüssel für die Automatik erzeugen ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
    await einstellen(context, CFG);
    const { log, zustand } = await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    const js = []; page.on('pageerror', e => js.push(e.message));
    await page.goto(SEITE);
    pruefe(!(await page.locator('#auto-secret').isVisible()), 'B: vor der Zustimmung kein Feld für das Secret');
    await page.locator('#auto summary').click();
    await page.locator('#auto-consent').click();
    await page.waitForFunction(() => !location.search && document.getElementById('auto').open);
    const a = log.authorize[0];
    pruefe(a && a.searchParams.get('response_type') === 'code' && !a.searchParams.get('code_challenge'), 'B: Zustimmung im Ablauf mit Client-Secret, ohne PKCE');
    pruefe(a && a.searchParams.get('redirect_uri') === SEITE && a.searchParams.get('client_id') === 'KENNUNG', 'B: richtige Adresse und Client-ID');
    pruefe(a && /user-modify-playback-state/.test(a.searchParams.get('scope')) && /user-read-playback-state/.test(a.searchParams.get('scope')), 'B: nur die beiden Rechte für die Wiedergabe');
    pruefe(await page.locator('#auto-secret').isVisible(), 'B: nach der Zustimmung Feld für das Secret');
    pruefe(page.url() === SEITE, 'B: Adresse wieder sauber');
    await page.locator('#auto-make').click();
    pruefe((await page.locator('#auto-note').textContent()).includes('einfügen'), 'B: leeres Secret wird abgefangen');
    zustand.tokenAntwort = () => ({ status: 400, body: { error: 'invalid_client', error_description: 'Invalid client secret' } });
    await page.locator('#auto-secret').fill('FALSCH');
    await page.locator('#auto-make').click();
    await bisZu(async () => (await page.locator('#auto-note').textContent()).includes('Stimmt das'));
    pruefe((await page.locator('#auto-note').textContent()).includes('Invalid client secret'), 'B: falsches Secret wird gemeldet');
    pruefe(await page.locator('#auto-secret').isVisible(), 'B: nach falschem Secret bleibt das Feld');
    zustand.tokenAntwort = () => ({ status: 200, body: { access_token: 'ZUGRIFF', refresh_token: 'ERNEUERN', expires_in: 3600 } });
    await page.locator('#auto-secret').fill('RICHTIG');
    await page.locator('#auto-make').click();
    await page.waitForFunction(() => !document.getElementById('auto-step-key').hidden);
    const f = log.token[log.token.length - 1];
    pruefe(f.get('grant_type') === 'authorization_code' && f.get('code') === 'CODE123' && f.get('client_secret') === 'RICHTIG', 'B: Tausch mit Code und Secret');
    pruefe(await page.locator('#auto-secret').inputValue() === '' && !(await page.locator('#auto-secret').isVisible()), 'B: Secret-Feld danach leer und weg');
    pruefe(!(await page.locator('#auto-key').isVisible()), 'B: Schlüssel steht nicht offen auf der Seite');
    if (BILDER) await page.screenshot({ path: path.join(BILDER, 'auto-schluessel-dunkel.png'), fullPage: true });
    await page.locator('#auto-copy').click();
    await bisZu(async () => (await page.locator('#auto-note').textContent()).includes('kopiert'));
    const kopiert = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    pruefe(kopiert.client_id === 'KENNUNG' && kopiert.client_secret === 'RICHTIG' && kopiert.refresh_token === 'ERNEUERN', 'B: kopierter Schlüssel ist vollständig');
    pruefe((await page.locator('#auto-github').getAttribute('href')) === 'https://github.com/MaxwellSilverhammer-mk/wegwart-klang/settings/secrets/actions/new', 'B: Verweis auf das neue Secret in GitHub');
    const speicher = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    pruefe(!/RICHTIG|FALSCH|ERNEUERN|CODE123/.test(speicher), 'B: nichts Geheimes im Browserspeicher');
    pruefe(js.length === 0, 'B: keine Skriptfehler ' + js.join(' | '));
    await context.close();
  }

  // ---------- B2: abgelaufene Zustimmung ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await einstellen(context, CFG);
    const { zustand } = await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    await page.goto(SEITE);
    await page.locator('#auto summary').click();
    await page.locator('#auto-consent').click();
    await page.waitForFunction(() => !document.getElementById('auto-step-secret').hidden);
    zustand.tokenAntwort = () => ({ status: 400, body: { error: 'invalid_grant' } });
    await page.locator('#auto-secret').fill('RICHTIG');
    await page.locator('#auto-make').click();
    await bisZu(async () => (await page.locator('#auto-note').textContent()).includes('abgelaufen'));
    pruefe((await page.locator('#auto-note').textContent()).includes('abgelaufen') && !(await page.locator('#auto-secret').isVisible()), 'B2: abgelaufene Zustimmung führt zurück zu Schritt 1');
    await context.close();
  }

  // ---------- C: Die Seite steuert Spotify selbst ----------
  {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await einstellen(context, { clientId: 'KENNUNG', mode: 'connect', interval: 5, fadeSec: 1 });
    const { log, zustand } = await dienste(context, { signal: SIGNAL('wald'), player: { aktiv: true, spielt: true, ctx: 'spotify:album:fremd', vol: 60 } });
    const page = await context.newPage();
    const js = []; page.on('pageerror', e => js.push(e.message));
    await page.goto(SEITE);
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Mit Spotify verbinden');
    pruefe(await page.locator('#setup').isVisible(), 'C: Karte zur Einrichtung sichtbar');
    await page.locator('#start').click();
    await bisZu(() => zustand.player.ctx === URI.wald, 8000, 'erster Start');
    const a = log.authorize[0];
    pruefe(a && a.searchParams.get('code_challenge_method') === 'S256', 'C: Anmeldung der Seite mit PKCE');
    pruefe(zustand.player.ctx === URI.wald, 'C: nach der Anmeldung spielt die Playlist des Ortes');
    await bisZu(() => (zustand.player.vol === 60), 4000);
    pruefe(zustand.player.vol === 60, 'C: Lautstärke nach dem Start wieder wie vorher');

    // Neuer Ort: Wechsel mit Überblendung.
    zustand.player.volLog = [];
    zustand.signal = SIGNAL('sumpf', 2); zustand.version++;
    await bisZu(() => zustand.player.ctx === URI.sumpf, 9000, 'Wechsel');
    pruefe(zustand.player.ctx === URI.sumpf, 'C: neuer Ort schaltet um');
    await bisZu(() => zustand.player.vol === 60, 4000);
    pruefe(zustand.player.volLog.includes(0) && zustand.player.vol === 60, 'C: Überblendung auf null und zurück');
    await page.waitForFunction(() => document.getElementById('now-eyebrow').textContent === 'Ort 2');

    // Spielen schlägt nach dem Abblenden fehl: nicht stumm bleiben, beim nächsten Mal noch einmal.
    zustand.player.playFehler = [{ status: 403, message: 'Gesperrt', reason: 'PREMIUM_REQUIRED' }, { status: 403, message: 'Gesperrt', reason: 'PREMIUM_REQUIRED' }];
    zustand.player.volLog = [];
    zustand.signal = SIGNAL('dorf', 3); zustand.version++;
    await bisZu(() => zustand.player.playFehler.length === 0, 9000, 'Fehlschlag');
    await bisZu(() => zustand.player.vol === 60, 4000);
    pruefe(zustand.player.vol === 60 && zustand.player.ctx === URI.sumpf, 'C: Fehlschlag lässt die Lautstärke nicht auf null');
    await bisZu(async () => (await page.locator('#status').textContent()).includes('Premium'), 3000);
    pruefe((await page.locator('#status').textContent()).includes('Premium'), 'C: Fehlschlag wird verständlich gemeldet');
    await bisZu(() => zustand.player.ctx === URI.dorf, 9000, 'zweiter Versuch');
    pruefe(zustand.player.ctx === URI.dorf, 'C: nächste Prüfung holt den Wechsel nach');

    // Wechsel während eines Wechsels geht nicht verloren.
    zustand.player.playDauer = 2500;
    zustand.signal = SIGNAL('nacht', 4); zustand.version++;
    await bisZu(() => log.spotify.filter(s => s.m === 'PUT' && s.p === '/me/player/play' && s.b.context_uri === URI.nacht).length > 0, 9000);
    zustand.signal = SIGNAL('wald', 5); zustand.version++;
    zustand.player.playDauer = 0;
    await bisZu(() => zustand.player.ctx === URI.wald, 15000, 'zweiter Wechsel');
    pruefe(zustand.player.ctx === URI.wald, 'C: während eines Wechsels gesetzter Ort kommt an');
    pruefe(js.length === 0, 'C: keine Skriptfehler ' + js.join(' | '));
    await context.close();
  }

  // ---------- C2: kein aktives Gerät ----------
  {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await einstellen(context, { clientId: 'KENNUNG', mode: 'connect', interval: 5, fadeSec: 0 });
    const { zustand } = await dienste(context, { signal: SIGNAL('wald'), player: { aktiv: false, spielt: false, ctx: null, vol: 50, geraete: [], playFehler: [{ status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' }, { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' }] } });
    const page = await context.newPage();
    await page.goto(SEITE);
    await page.locator('#start').click();
    await bisZu(async () => (await page.locator('#status').textContent()).includes('Kein Spotify-Gerät'), 8000);
    pruefe((await page.locator('#status').textContent()).includes('Kein Spotify-Gerät'), 'C2: ohne Gerät klare Meldung');
    zustand.player.geraete = [{ id: 'g2', name: 'Laptop', is_active: false, type: 'Computer' }];
    await bisZu(() => zustand.player.ctx === URI.wald, 9000, 'Gerät da');
    pruefe(zustand.player.ctx === URI.wald, 'C2: sobald Spotify offen ist, startet die Prüfung den Ort nach');
    await context.close();
  }

  // ---------- D: Takt der Abfragen ohne Token ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await einstellen(context, CFG);
    const { log } = await dienste(context, { signal: SIGNAL('wald'), ratelimit: { limit: 60, remaining: 59, resetAt: Date.parse('2026-11-04T13:00:00Z') / 1000 }, player: {} });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-11-04T12:00:00Z') });
    await page.goto(SEITE);
    await warte(300);
    // Eine simulierte Stunde: Der Rest des Kontingents wird verteilt, nichts läuft über.
    for (let t = 0; t < 360; t++) {
      await page.clock.runFor(10000);
      await warte(8);
    }
    pruefe(log.github >= 40 && log.github <= 60, 'D: eine Stunde ohne Token: ' + log.github + ' Abfragen (höchstens 60 erlaubt)');
    pruefe(!(await page.locator('#status').textContent()).includes('bremst'), 'D: GitHub bremst nicht');
    await context.close();
  }

  // ---------- D2: GitHub bremst ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await einstellen(context, CFG);
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://api.github.com/**', r => r.fulfill({ status: 403, headers: { ...CORS, 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600) }, body: '{}' }));
    const page = await context.newPage();
    await page.goto(SEITE);
    await bisZu(async () => (await page.locator('#status').textContent()).includes('bremst'));
    const t = await page.locator('#status').textContent();
    pruefe(/in (9|10) Minuten/.test(t), 'D2: Meldung nennt die Wartezeit: ' + t);
    await context.close();
  }

  // ---------- E: Player auf der Seite ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await einstellen(context, { mode: 'embed' });
    const { log } = await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    const js = []; page.on('pageerror', e => js.push(e.message));
    await page.goto(SEITE);
    await page.waitForFunction(() => document.getElementById('now-name').textContent === 'Wald und Hain');
    await bisZu(() => log.fremd.some(u => u.includes('iframe-api')), 2000);
    pruefe(log.fremd.some(u => u.includes('iframe-api')), 'E: Player-Skript wird nur in diesem Modus geladen');
    pruefe(await page.locator('#start').isVisible() && !(await page.locator('#open-now').isVisible()), 'E: Startknopf statt Öffnen-Verweis');
    pruefe(await page.locator('button.ort-play:visible').count() === 9, 'E: Liste mit Abspielen-Knöpfen');
    pruefe(js.length === 0, 'E: keine Skriptfehler ' + js.join(' | '));
    await context.close();
  }

  // ---------- F: Modus wechseln und speichern ----------
  {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await einstellen(context, CFG);
    await dienste(context, { signal: SIGNAL('wald'), player: {} });
    const page = await context.newPage();
    await page.goto(SEITE);
    await page.locator('#settings summary').click();
    pruefe(await page.locator('#mode-auto').isChecked(), 'F: Automatik vorgewählt');
    await page.locator('#mode-connect').check();
    await page.locator('#cfg-form button[type=submit]').click();
    await page.waitForFunction(() => document.body.dataset.mode === 'connect');
    pruefe(await page.locator('#start').isVisible() && !(await page.locator('#auto').isVisible()), 'F: Umschalten auf „Diese Seite steuert“');
    await page.locator('#mode-auto').check();
    await page.locator('#cfg-form button[type=submit]').click();
    await page.waitForFunction(() => document.body.dataset.mode === 'auto');
    pruefe(await page.locator('#open-now').isVisible() && await page.locator('#auto').isVisible(), 'F: zurück auf Automatik');
    if (BILDER) await page.screenshot({ path: path.join(BILDER, 'einstellungen-breit.png'), fullPage: true });
    await context.close();
  }

  await browser.close();
  server.close();
  console.log(fehler ? '\n' + fehler + ' FEHLER' : '\nAlles bestanden');
  process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
