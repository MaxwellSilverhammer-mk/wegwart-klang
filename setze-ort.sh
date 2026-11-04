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
# Schlägt das Schieben fehl (eine andere Sitzung war schneller, Netz), noch einmal von vorn.
for VERSUCH in 1 2 3; do
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
  if git push -q origin "$BRANCH"; then
    echo "Klang gesetzt: $ORT${ORTNAME:+ – $ORTNAME}"
    # Ging der letzte Lauf der Automatik schief (etwa ein abgelaufener Schlüssel), soll die Spielleitung es sagen.
    REPO="$(git remote get-url origin | sed -E 's#^.*github\.com[/:]##; s#\.git$##')"
    curl -fsS --max-time 8 "https://api.github.com/repos/$REPO/actions/workflows/klang.yml/runs?per_page=1&status=completed" 2>/dev/null | python3 -c '
import json, sys
try:
    laeufe = json.load(sys.stdin).get("workflow_runs") or []
except ValueError:
    laeufe = []
if laeufe and laeufe[0].get("conclusion") == "failure":
    print("ACHTUNG: Der letzte Lauf der Klang-Automatik ist fehlgeschlagen: " + laeufe[0].get("html_url", "") + " – sag das dem Spieler in einem Satz in Klammern.")
' || true
    exit 0
  fi
  sleep 2
done
echo "Klang konnte nicht gesetzt werden: Schieben dreimal fehlgeschlagen." >&2
exit 1
