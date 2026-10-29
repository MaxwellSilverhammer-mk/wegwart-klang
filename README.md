# Klangtisch · Live

Musik für das Textabenteuer **Wegwart der Seeprinzen**, die von selbst wechselt: Die Spielleitung setzt beim 🧭 den Ortstyp in `klang.json`, die Seite `index.html` liest die Datei alle paar Sekunden und schaltet die passende Orts-Playlist um – mit Überblendung, wenn sie die Spotify-App steuert.

## Zwei Wiedergabe-Arten

| | Spotify-App steuern (empfohlen) | Player auf der Seite |
|---|---|---|
| Musik kommt aus | deiner Spotify-App (Rechner, Handy, Lautsprecher) | dem eingebetteten Player im Browser |
| Wechsel | sofort, mit Überblendung (einstellbar) | am Ende des laufenden Stücks, spätestens nach 60 s |
| Einmalige Einrichtung | Spotify-Entwickler-App anlegen, Client-ID eintragen, einmal verbinden | keine; Spotify-Anmeldung im Player |
| Braucht | Seite über **https** (GitHub Pages), Spotify Premium | Browser auf dem Rechner, Spotify-Anmeldung im Player (Premium für volle Titel) |

## Einrichtung

1. **Seite veröffentlichen**: In diesem Repository unter *Settings → Pages* den Zweig `main` (Ordner `/`) wählen. Die Seite ist dann unter `https://<benutzer>.github.io/wegwart-klang/` erreichbar. (Ohne Pages lässt sich `index.html` auch als Datei öffnen – dann nur mit dem Player auf der Seite.)
2. **Spotify-App anlegen** (für die App-Steuerung): Auf [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) eine App erstellen, bei *Redirect URIs* genau die Adresse der Seite eintragen, die der Klangtisch unter „Spotify-App verbinden“ anzeigt (mit Schrägstrich am Ende), bei *APIs used* „Web API“ wählen. Die **Client ID** kopieren.
3. Im Klangtisch unter *Einstellungen* die Client-ID eintragen, speichern, dann **Mit Spotify verbinden**. Spotify muss auf dem Gerät geöffnet sein, auf dem gespielt werden soll; unter *Geräte laden* lässt sich ein festes Gerät wählen.
4. **Klangtisch starten**. Ab jetzt wechselt die Musik, sobald die Spielleitung einen neuen Ort setzt.

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
- `gesetzt` – Zeitstempel in UTC; eine Änderung hier löst den Wechsel aus, auch beim gleichen Ortstyp

In einer Claude-Sitzung mit angebundenem Repository (`add_repo` mit Schreibzugriff) – einmal je Sitzung klonen, dann bei jedem 🧭 das Skript aufrufen:

```bash
# einmal je Sitzung
git clone -q --depth 1 -b main https://github.com/MaxwellSilverhammer-mk/wegwart-klang /home/claude/wegwart-klang

# bei jedem 🧭 (Ortstyp, Ortsname, Hinweis)
/home/claude/wegwart-klang/setze-ort.sh hafenstadt "Monmurg" "Die Werft hämmert bis in die Nacht."
```

Das Skript holt zuerst den aktuellen Stand, schreibt `klang.json`, erzeugt einen Commit „Klang: …“ und schiebt ihn. Ohne Skript geht es auch von Hand: Datei ändern, committen, pushen. (Die GitHub-API lässt sich aus Claude-Sitzungen nur lesen, nicht schreiben; deshalb der Weg über git.)

Regel: nur beim 🧭 setzen, und nur, wenn sich der Ortstyp ändert. Innerhalb eines Ortes bleibt die Musik, auch im Kampf.

## Orts-Playlists

Die neun Playlists (je 150 Minuten, instrumental, Klangteppich ohne Spitzen) liegen privat im Spotify-Konto des Weltenhüters; ihre Kennungen stehen in `index.html`.

## Hinweise

- Die Seite fragt GitHub ohne Anmeldung ab (60 Anfragen pro Stunde je Adresse, unveränderte Antworten zählen nicht). Bei einem privaten Repository oder sehr kurzen Abständen ein Token mit Leserecht auf `contents` in den Einstellungen eintragen.
- Einstellungen und die Spotify-Verbindung bleiben im Browser gespeichert, auf dem die Seite geöffnet wurde.
