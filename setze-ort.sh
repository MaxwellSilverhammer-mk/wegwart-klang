#!/usr/bin/env bash
# Setzt den Ort für den Klangtisch (Wegwart der Seeprinzen) und schiebt ihn ins Repository.
# Aufruf:  ./setze-ort.sh <ortstyp> ["Ortsname"] ["Hinweis"]
# Ortstypen: hafenstadt dorf landstrasse kueste wald sumpf nacht schenke ruinen
# Läuft in einem Klon dieses Repositorys (git mit Schreibzugriff), braucht python3.
set -euo pipefail

ORT="${1:-}"
ORTNAME="${2:-}"
HINWEIS="${3:-}"
DATEI="klang.json"

case "$ORT" in
  hafenstadt|dorf|landstrasse|kueste|wald|sumpf|nacht|schenke|ruinen) ;;
  *) echo "Unbekannter Ortstyp: '$ORT'. Erlaubt: hafenstadt dorf landstrasse kueste wald sumpf nacht schenke ruinen" >&2; exit 2 ;;
esac

cd "$(dirname "$0")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Immer vom aktuellen Stand ausgehen; geändert wird hier nur die Signaldatei.
git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"

ORT="$ORT" ORTNAME="$ORTNAME" HINWEIS="$HINWEIS" python3 - > "$DATEI" <<'PY'
import json, os, datetime
print(json.dumps({
    "ort": os.environ["ORT"],
    "ortname": os.environ["ORTNAME"],
    "hinweis": os.environ["HINWEIS"],
    "gesetzt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, ensure_ascii=False, indent=2))
PY

git -c user.name="Spielleitung" -c user.email="spielleitung@wegwart.local" commit -q -m "Klang: $ORT${ORTNAME:+ ($ORTNAME)}" -- "$DATEI"
git push -q origin "$BRANCH"
echo "Klang gesetzt: $ORT${ORTNAME:+ – $ORTNAME}"
