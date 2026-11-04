#!/usr/bin/env python3
"""Schaltet die Spotify-App auf die Orts-Playlist aus klang.json um.

Läuft in der GitHub-Automatik (.github/workflows/klang.yml). Geschaltet wird nur,
wenn in Spotify gerade eine der Orts-Playlists spielt; alles andere bleibt in Ruhe:
Pause, Podcast, eigene Musik, kein aktives Gerät. Das Spiel startet also nie von
selbst Musik; der Spieler startet einmal, danach wechselt sie von allein.

Das Protokoll eines öffentlichen Repositorys kann jeder lesen: Es nennt deshalb nur
den Ortstyp und was geschah, keine Gerätenamen, keine Titel und nie den Schlüssel.
Nur Python-Standardbibliothek, damit der Lauf nichts installieren muss.
"""
import base64
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.spotify.com/v1"
ANMELDUNG = "https://accounts.spotify.com/api/token"
BLENDE_SEKUNDEN = 3.0
BLENDE_STUFEN = 6
ZUFALL_BEREICH = 20  # Start irgendwo in den ersten Titeln, wie auf der Seite


class SpotifyFehler(Exception):
    def __init__(self, status, nachricht, grund=""):
        super().__init__(nachricht)
        self.status = status
        self.grund = grund


def orte_lesen(pfad="index.html"):
    """Die Orte stehen nur einmal, in der Seite: Schlüssel und Playlist-Kennung."""
    with open(pfad, encoding="utf-8") as datei:
        text = datei.read()
    orte = dict(re.findall(r"\{key:'(\w+)',name:'[^']*',line:'[^']*',id:'(\w+)'\}", text))
    if not orte:
        raise SystemExit("Keine Orte in index.html gefunden.")
    return {schluessel: "spotify:playlist:" + kennung for schluessel, kennung in orte.items()}


def anfrage(methode, adresse, daten=None, kopf=None):
    # PUT und POST brauchen auch ohne Inhalt eine Länge, sonst antwortet Spotify mit 411.
    if daten is None and methode in ("PUT", "POST"):
        daten = b""
    frage = urllib.request.Request(adresse, data=daten, method=methode, headers=kopf or {})
    try:
        with urllib.request.urlopen(frage, timeout=15) as antwort:
            return antwort.status, antwort.read(), antwort.headers
    except urllib.error.HTTPError as fehler:
        return fehler.code, fehler.read(), fehler.headers


def zugriff_holen(zugang):
    form = urllib.parse.urlencode(
        {"grant_type": "refresh_token", "refresh_token": zugang["refresh_token"]}
    ).encode()
    basis = base64.b64encode(
        (zugang["client_id"] + ":" + zugang["client_secret"]).encode()
    ).decode()
    status, roh, _ = anfrage(
        "POST",
        ANMELDUNG,
        form,
        {"Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + basis},
    )
    try:
        inhalt = json.loads(roh or b"{}")
    except ValueError:
        inhalt = {}
    if status != 200 or "access_token" not in inhalt:
        raise SystemExit(
            "Spotify nimmt den Schlüssel nicht an (Status %s, %s). "
            "Schlüssel neu erzeugen, siehe README." % (status, inhalt.get("error", "unbekannt"))
        )
    print("::add-mask::" + inhalt["access_token"], flush=True)
    return inhalt["access_token"]


def api(token, methode, pfad, inhalt=None):
    kopf = {"Authorization": "Bearer " + token}
    daten = None
    if inhalt is not None:
        daten = json.dumps(inhalt).encode()
        kopf["Content-Type"] = "application/json"
    status, roh, antwortkopf = None, b"", {}
    for versuch in range(3):
        status, roh, antwortkopf = anfrage(methode, API + pfad, daten, kopf)
        if status == 429:
            time.sleep(min(int(antwortkopf.get("Retry-After") or 1), 10))
            continue
        if status >= 500 and versuch < 2:
            time.sleep(1)
            continue
        break
    if 200 <= status < 300:
        return json.loads(roh) if roh else None
    try:
        fehler = json.loads(roh).get("error", {})
    except (ValueError, AttributeError):
        fehler = {}
    if not isinstance(fehler, dict):
        fehler = {"message": str(fehler)}
    raise SpotifyFehler(
        status, fehler.get("message") or "Status %s" % status, fehler.get("reason", "")
    )


def geraet_anhang(geraet_id, trenner="?"):
    return trenner + "device_id=" + urllib.parse.quote(geraet_id) if geraet_id else ""


def blende(token, von, bis, geraet_id):
    """Fährt die Lautstärke in Stufen; False, wenn das Gerät das nicht mitmacht."""
    for stufe in range(1, BLENDE_STUFEN + 1):
        wert = round(von + (bis - von) * stufe / BLENDE_STUFEN)
        try:
            api(
                token,
                "PUT",
                "/me/player/volume?volume_percent=%d%s" % (wert, geraet_anhang(geraet_id, "&")),
            )
        except SpotifyFehler:
            return False
        if stufe < BLENDE_STUFEN:
            time.sleep(BLENDE_SEKUNDEN / BLENDE_STUFEN)
    return True


def spielen(token, ziel, geraet_id):
    anhang = geraet_anhang(geraet_id)
    inhalt = {"context_uri": ziel, "offset": {"position": random.randrange(ZUFALL_BEREICH)}}
    try:
        api(token, "PUT", "/me/player/play" + anhang, inhalt)
    except SpotifyFehler as fehler:
        # Hat die Playlist weniger Titel als der Zufall meint, ohne Startpunkt noch einmal.
        if fehler.grund == "PREMIUM_REQUIRED" or not 400 <= fehler.status < 500:
            raise
        api(token, "PUT", "/me/player/play" + anhang, {"context_uri": ziel})
    try:
        api(token, "PUT", "/me/player/shuffle?state=true" + geraet_anhang(geraet_id, "&"))
    except SpotifyFehler:
        pass  # Die Musik läuft, nur eben der Reihe nach.


def wechseln(token, ziel, orts_playlists):
    """Gibt zurück, was geschah; wirft SpotifyFehler nur, wenn Spotify das Spielen verweigert."""
    stand = api(token, "GET", "/me/player")
    if not stand:
        return "Spotify ist auf keinem Gerät aktiv, nichts zu tun."
    if not stand.get("is_playing"):
        return "Spotify ist pausiert, nichts zu tun."
    jetzt = (stand.get("context") or {}).get("uri")
    if jetzt == ziel:
        return "Die Playlist läuft schon."
    if jetzt not in orts_playlists:
        return "In Spotify läuft gerade etwas anderes als eine Orts-Playlist, nichts zu tun."

    geraet = stand.get("device") or {}
    geraet_id = geraet.get("id") or ""
    lautstaerke = geraet.get("volume_percent")
    if geraet.get("supports_volume") is False or not lautstaerke:
        lautstaerke = None

    abgeblendet = False
    try:
        if lautstaerke is not None:
            abgeblendet = blende(token, lautstaerke, 0, geraet_id)
        spielen(token, ziel, geraet_id)
        if abgeblendet:
            time.sleep(0.5)
            if blende(token, 0, lautstaerke, geraet_id):
                lautstaerke = None  # schon wieder oben
    finally:
        # Auch nach einem Fehler nie stumm zurücklassen.
        if lautstaerke is not None:
            try:
                api(
                    token,
                    "PUT",
                    "/me/player/volume?volume_percent=%d%s"
                    % (lautstaerke, geraet_anhang(geraet_id, "&")),
                )
            except SpotifyFehler:
                pass
    return "Umgeschaltet" + (" mit Überblendung." if abgeblendet else " ohne Überblendung.")


def main():
    roh = os.environ.get("KLANG_SPOTIFY", "").strip()
    if not roh:
        print("Automatik nicht eingerichtet (Secret KLANG_SPOTIFY fehlt), nichts zu tun.")
        return 0
    try:
        zugang = json.loads(roh)
        for wert in (zugang["client_secret"], zugang["refresh_token"]):
            print("::add-mask::" + wert, flush=True)
        zugang["client_id"]
    except (ValueError, KeyError, TypeError):
        print("Das Secret KLANG_SPOTIFY ist kein gültiger Schlüssel. Neu erzeugen, siehe README.")
        return 1

    with open("klang.json", encoding="utf-8") as datei:
        ort = json.load(datei).get("ort", "")
    orte = orte_lesen()
    if ort not in orte:
        print("Unbekannter Ortstyp in klang.json, nichts zu tun.")
        return 0

    token = zugriff_holen(zugang)
    try:
        ergebnis = wechseln(token, orte[ort], set(orte.values()))
    except SpotifyFehler as fehler:
        if fehler.grund == "PREMIUM_REQUIRED":
            print("Spotify verlangt für die Steuerung ein Premium-Konto.")
        else:
            print("Spotify lehnt den Wechsel ab: Status %s, %s" % (fehler.status, fehler))
        return 1
    print("%s: %s" % (ort, ergebnis))
    zusammenfassung = os.environ.get("GITHUB_STEP_SUMMARY")
    if zusammenfassung:
        with open(zusammenfassung, "a", encoding="utf-8") as datei:
            datei.write("**%s:** %s\n" % (ort, ergebnis))
    return 0


if __name__ == "__main__":
    sys.exit(main())
