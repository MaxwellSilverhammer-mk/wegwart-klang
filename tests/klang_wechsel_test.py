#!/usr/bin/env python3
"""Prüft die Automatik gegen ein nachgestelltes Spotify. Aufruf: python3 tests/klang_wechsel_test.py"""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

WURZEL = Path(__file__).resolve().parent.parent
plan = importlib.util.spec_from_file_location("klang_wechsel", WURZEL / ".github" / "klang_wechsel.py")
kw = importlib.util.module_from_spec(plan)
plan.loader.exec_module(kw)

ORTE = kw.orte_lesen(str(WURZEL / "index.html"))
ALT = ORTE["landstrasse"]
NEU = ORTE["wald"]


class Spotify:
    """Spielt Spotify nach: merkt sich jede Anfrage und antwortet wie die echte API."""

    def __init__(self, stand=None, play_antworten=None, volume_fehler=False, token_status=200):
        self.stand = stand
        self.play_antworten = list(play_antworten or [])
        self.volume_fehler = volume_fehler
        self.token_status = token_status
        self.anfragen = []

    def __call__(self, methode, adresse, daten=None, kopf=None):
        self.anfragen.append((methode, adresse, daten, kopf))
        if adresse == kw.ANMELDUNG:
            if self.token_status != 200:
                return self.token_status, b'{"error":"invalid_grant"}', {}
            return 200, b'{"access_token":"zugriff"}', {}
        pfad = adresse[len(kw.API):]
        if methode == "GET" and pfad == "/me/player":
            if self.stand is None:
                return 204, b"", {}
            return 200, json.dumps(self.stand).encode(), {}
        if pfad.startswith("/me/player/volume"):
            if self.volume_fehler:
                return 403, b'{"error":{"status":403,"message":"nein","reason":"VOLUME_CONTROL_DISALLOW"}}', {}
            return 204, b"", {}
        if pfad.startswith("/me/player/shuffle"):
            return 204, b"", {}
        if pfad.startswith("/me/player/play"):
            if self.play_antworten:
                return self.play_antworten.pop(0)
            if self.stand:
                self.stand["context"] = {"uri": json.loads(daten)["context_uri"]}
            return 204, b"", {}
        raise AssertionError("unerwartet: %s %s" % (methode, adresse))

    def befehle(self, teil):
        return [a for a in self.anfragen if teil in a[1] and a[0] != "GET"]

    def lautstaerken(self):
        werte = []
        for _, adresse, _, _ in self.befehle("/me/player/volume"):
            werte.append(int(adresse.split("volume_percent=")[1].split("&")[0]))
        return werte


def stand(uri=ALT, spielt=True, lautstaerke=70, stellbar=True):
    return {
        "is_playing": spielt,
        "context": {"uri": uri} if uri else None,
        "device": {"id": "geraet1", "volume_percent": lautstaerke, "supports_volume": stellbar},
    }


class Wechseln(unittest.TestCase):
    def setUp(self):
        kommt = mock.patch.object(kw.time, "sleep", lambda *_: None)
        kommt.start()
        self.addCleanup(kommt.stop)

    def lauf(self, spotify, ziel=NEU):
        with mock.patch.object(kw, "anfrage", spotify):
            return kw.wechseln("zugriff", ziel, set(ORTE.values()))

    def test_neun_orte_aus_der_seite(self):
        self.assertEqual(
            set(ORTE),
            {"hafenstadt", "dorf", "landstrasse", "kueste", "wald", "sumpf", "nacht", "schenke", "ruinen"},
        )

    def test_schaltet_mit_ueberblendung_und_laesst_die_lautstaerke_wie_sie_war(self):
        s = Spotify(stand())
        self.assertIn("mit Überblendung", self.lauf(s))
        self.assertEqual(s.stand["context"]["uri"], NEU)
        werte = s.lautstaerken()
        self.assertEqual(werte[kw.BLENDE_STUFEN - 1], 0)
        self.assertEqual(werte[-1], 70)
        self.assertEqual(len(s.befehle("/me/player/shuffle")), 1)
        play = s.befehle("/me/player/play")[0]
        self.assertIn("device_id=geraet1", play[1])

    def test_ohne_inhalt_wird_die_laenge_mitgeschickt(self):
        gesehen = []

        class Antwort:
            status = 204
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b""

        def oeffnen(frage, timeout=None):
            gesehen.append(frage)
            return Antwort()

        with mock.patch.object(kw.urllib.request, "urlopen", oeffnen):
            kw.anfrage("PUT", kw.API + "/me/player/shuffle?state=true")
        self.assertEqual(gesehen[0].data, b"")

    def test_kein_geraet_pause_und_fremde_musik_bleiben_in_ruhe(self):
        for bild, wort in (
            (None, "auf keinem Gerät"),
            (stand(spielt=False), "pausiert"),
            (stand(uri="spotify:album:eigenes"), "etwas anderes"),
            (stand(uri=None), "etwas anderes"),
        ):
            s = Spotify(bild)
            self.assertIn(wort, self.lauf(s))
            self.assertEqual([a for a in s.anfragen if a[0] != "GET"], [], wort)

    def test_gleiche_playlist_startet_nicht_neu(self):
        s = Spotify(stand(uri=NEU))
        self.assertIn("läuft schon", self.lauf(s))
        self.assertEqual(s.befehle("/me/player"), [])

    def test_geraet_ohne_lautstaerke_schaltet_hart(self):
        s = Spotify(stand(stellbar=False))
        self.assertIn("ohne Überblendung", self.lauf(s))
        self.assertEqual(s.lautstaerken(), [])
        self.assertEqual(s.stand["context"]["uri"], NEU)

    def test_lautstaerke_abgelehnt_schaltet_trotzdem(self):
        s = Spotify(stand(), volume_fehler=True)
        self.assertIn("ohne Überblendung", self.lauf(s))
        self.assertEqual(s.stand["context"]["uri"], NEU)

    def test_nach_fehlschlag_nie_stumm(self):
        premium = (403, b'{"error":{"status":403,"message":"Premium","reason":"PREMIUM_REQUIRED"}}', {})
        s = Spotify(stand(), play_antworten=[premium])
        with self.assertRaises(kw.SpotifyFehler):
            self.lauf(s)
        self.assertEqual(s.lautstaerken()[-1], 70)
        self.assertEqual(s.stand["context"]["uri"], ALT)

    def test_startpunkt_abgelehnt_versucht_es_ohne(self):
        s = Spotify(stand(), play_antworten=[(400, b'{"error":{"status":400,"message":"offset"}}', {})])
        self.assertIn("Umgeschaltet", self.lauf(s))
        koerper = [json.loads(a[2]) for a in s.befehle("/me/player/play")]
        self.assertIn("offset", koerper[0])
        self.assertNotIn("offset", koerper[1])


class Hauptlauf(unittest.TestCase):
    SCHLUESSEL = json.dumps({"client_id": "kennung", "client_secret": "GEHEIM1", "refresh_token": "GEHEIM2"})

    def setUp(self):
        self.ordner = tempfile.TemporaryDirectory()
        self.addCleanup(self.ordner.cleanup)
        alt = os.getcwd()
        os.chdir(self.ordner.name)
        self.addCleanup(os.chdir, alt)
        Path("index.html").write_text((WURZEL / "index.html").read_text(encoding="utf-8"), encoding="utf-8")
        Path("klang.json").write_text('{"ort":"wald","ortname":"Hain"}', encoding="utf-8")
        kommt = mock.patch.object(kw.time, "sleep", lambda *_: None)
        kommt.start()
        self.addCleanup(kommt.stop)

    def lauf(self, spotify, schluessel=SCHLUESSEL):
        with mock.patch.object(kw, "anfrage", spotify), mock.patch.dict(os.environ, {"KLANG_SPOTIFY": schluessel}), mock.patch("builtins.print") as druck:
            code = kw.main()
        return code, "\n".join(" ".join(map(str, a.args)) for a in druck.call_args_list)

    def test_erfolg_und_protokoll_ohne_geheimnis_ausser_maske(self):
        s = Spotify(stand())
        code, text = self.lauf(s)
        self.assertEqual(code, 0)
        self.assertIn("wald: Umgeschaltet", text)
        for zeile in text.splitlines():
            if not zeile.startswith("::add-mask::"):
                self.assertNotIn("GEHEIM", zeile)
                self.assertNotIn("zugriff", zeile)
        self.assertIn("::add-mask::GEHEIM2", text)

    def test_ohne_secret_still(self):
        s = Spotify(stand())
        code, text = self.lauf(s, "")
        self.assertEqual(code, 0)
        self.assertIn("nicht eingerichtet", text)
        self.assertEqual(s.anfragen, [])

    def test_kaputtes_secret_faellt_auf(self):
        code, text = self.lauf(Spotify(stand()), "{kein json")
        self.assertEqual(code, 1)
        self.assertIn("kein gültiger Schlüssel", text)

    def test_abgelehnter_schluessel_faellt_auf(self):
        with self.assertRaises(SystemExit) as ende:
            self.lauf(Spotify(stand(), token_status=400))
        self.assertIn("neu erzeugen", str(ende.exception))
        self.assertNotIn("GEHEIM", str(ende.exception))

    def test_unbekannter_ort_still(self):
        Path("klang.json").write_text('{"ort":"mond"}', encoding="utf-8")
        s = Spotify(stand())
        code, text = self.lauf(s)
        self.assertEqual(code, 0)
        self.assertIn("Unbekannter Ortstyp", text)
        self.assertEqual(s.anfragen, [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
