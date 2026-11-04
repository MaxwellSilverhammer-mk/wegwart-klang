# Klangtisch · Live

Musik für das Textabenteuer **Wegwart der Seeprinzen**, die von selbst wechselt: Die Spielleitung setzt beim 🧭 den Ortstyp in `klang.json`, und die passende Orts-Playlist läuft in deiner Spotify-App an, mit Überblendung, wo das Gerät es erlaubt. Du startest einmal je Sitzung, den Rest macht der Klangtisch.

## Drei Wiedergabe-Arten

| | GitHub-Automatik (empfohlen) | Seite steuert Spotify | Player auf der Seite |
|---|---|---|---|
| Wer schaltet | GitHub, etwa 20 s nach dem 🧭 | die offene Seite, bis zu 1 min später | die offene Seite, am Stückende oder nach spätestens 60 s |
| Muss eine Seite offen sein? | **nein**, geht auch nur mit dem Handy | ja, auf einem wachen Gerät | ja |
| Musik kommt aus | deiner Spotify-App | deiner Spotify-App | dem Browser |
| Braucht | Spotify Premium, Spotify-App, Schlüssel in GitHub | Spotify Premium, Spotify-App | Spotify-Anmeldung im Player |

Die Automatik schaltet **nur, solange in Spotify gerade eine der neun Orts-Playlists spielt**. Pause, Podcast, eigene Musik und „kein Gerät aktiv“ lässt sie in Ruhe, das Spiel startet also nie von selbst Musik. Zum Starten tippst du einmal auf den 🎶-Verweis im Spiel oder auf „In Spotify öffnen“ auf der [Seite](https://maxwellsilverhammer-mk.github.io/wegwart-klang/) und drückst Play.

## Einrichtung

1. **Seite veröffentlichen:** *Settings → Pages*, Zweig `main`, Ordner `/`.
2. **Spotify-App anlegen:** Auf [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) eine App erstellen, bei *Redirect URIs* genau die Adresse der Seite eintragen (mit Schrägstrich am Ende), bei *APIs used* „Web API“ wählen. Spotify verlangt dafür Premium. Die Client-ID steht in `index.html` unter `DEFAULTS` oder wird unter *Einstellungen* auf der Seite eingetragen; sie ist nicht geheim.
3. **Schlüssel erzeugen:** Auf der Seite *Automatik einrichten* aufklappen, bei Spotify zustimmen, das Client-Secret einfügen. Der Schlüssel entsteht im Browser und wird nirgends gespeichert.
4. **Schlüssel ablegen:** *Settings → Secrets and variables → Actions → New repository secret*, Name `KLANG_SPOTIFY`, Wert einfügen.

Fertig; die Seite muss danach nicht mehr offen sein. Meldet ein Lauf „Spotify nimmt den Schlüssel nicht an“, die Schritte 3 und 4 wiederholen und das Secret überschreiben.

**Was der Schlüssel darf:** nur die Wiedergabe lesen und steuern (`user-read-playback-state`, `user-modify-playback-state`), nicht an Playlists oder Kontodaten. Das Secret bleibt verschlossen, auch wenn das Repository öffentlich ist: Das Protokoll maskiert es, und Pull Requests von Fremden lösen die Automatik nicht aus. Das Protokoll eines Laufs (*Actions → Klang*) nennt nur den Ortstyp und was geschah.

## Für die Spielleitung

`klang.json` hat vier Felder:

```json
{
  "ort": "hafenstadt",
  "ortname": "Monmurg",
  "hinweis": "Die Werft hämmert bis in die Nacht.",
  "gesetzt": "2026-10-29T18:00:00Z"
}
```

- `ort` – Ortstyp: `hafenstadt`, `dorf`, `landstrasse`, `kueste`, `wald`, `sumpf`, `nacht`, `schenke`, `ruinen`
- `ortname` – Name des Ortes im Spiel (wahlweise)
- `hinweis` – ein Satz zur Stimmung (wahlweise)
- `gesetzt` – Zeitstempel in UTC; eine Änderung hier löst den Wechsel aus

In einer Claude-Sitzung mit angebundenem Repository (`add_repo` mit Schreibzugriff) – einmal je Sitzung klonen, dann bei jedem 🧭 mit neuem Ortstyp das Skript aufrufen:

```bash
# einmal je Sitzung
git clone -q --depth 1 -b main https://github.com/MaxwellSilverhammer-mk/wegwart-klang /home/claude/wegwart-klang

# bei jedem 🧭 mit neuem Ortstyp (Ortstyp, Ortsname, Hinweis)
/home/claude/wegwart-klang/setze-ort.sh hafenstadt "Monmurg" "Die Werft hämmert bis in die Nacht."
```

Das Skript holt den aktuellen Stand, schreibt `klang.json`, erzeugt einen Commit „Klang: …“ und schiebt ihn. (Die GitHub-API lässt sich aus Claude-Sitzungen nur lesen, nicht schreiben; deshalb der Weg über git.) Das Repository ist öffentlich: In `ortname` und `hinweis` steht nur, was die Figur weiß.

Regel: nur beim 🧭 setzen, und nur, wenn sich der Ortstyp ändert. Innerhalb eines Ortes bleibt die Musik, auch im Kampf.

## Orts-Playlists

Die neun Playlists (je 150 Minuten, instrumental, Klangteppich ohne Spitzen) liegen im Spotify-Konto des Weltenhüters; ihre Kennungen stehen nur in `index.html`, die Automatik liest sie von dort.

## Was wo liegt

| Datei | Wozu |
|---|---|
| `klang.json` | das Signal des Spiels |
| `setze-ort.sh` | setzt das Signal aus einer Sitzung |
| `.github/workflows/klang.yml`, `.github/klang_wechsel.py` | die Automatik |
| `index.html` | die Seite: zeigt den Ort, Start, Einrichtung, Liste der Orte |
| `tests/` | `python3 tests/klang_wechsel_test.py` und `node tests/seite_test.js` prüfen beides gegen nachgestellte Dienste |

## Hinweise

- Ohne Token erlaubt GitHub der Seite 60 Abfragen je Stunde und Adresse, auch unveränderte Antworten zählen (nachgemessen am 4.11.2026). Die Seite verteilt ihr Kontingent darum gleichmäßig, rund eine Abfrage pro Minute. Für die Automatik spielt das keine Rolle; sie braucht keine Abfragen.
- Eine eigene Figur eines anderen Spielers braucht ein eigenes Repository (Fork), eine eigene Spotify-App und einen eigenen Schlüssel, denn das Signal und die Spotify-App gelten für einen Spieler.
- Einstellungen und die Spotify-Verbindung der Seite bleiben im Browser gespeichert, auf dem sie geöffnet wurde. Den Schlüssel der Automatik speichert sie nicht.
