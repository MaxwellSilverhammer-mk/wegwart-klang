#!/usr/bin/env bash
# Setzt den Ort für den Klangtisch (Wegwart der Seeprinzen).
# Aufruf:  ./setze-ort.sh <ortstyp> ["Ortsname"] ["Hinweis"]
# Ortstypen: hafenstadt dorf landstrasse kueste wald sumpf nacht schenke ruinen
# Braucht: gh (angemeldet bzw. Sitzung mit angebundenem Repository, Schreibzugriff), python3.
set -euo pipefail

REPO="${KLANG_REPO:-MaxwellSilverhammer-mk/wegwart-klang}"
BRANCH="${KLANG_BRANCH:-main}"
DATEI="${KLANG_DATEI:-klang.json}"

ORT="${1:-}"
ORTNAME="${2:-}"
HINWEIS="${3:-}"

case "$ORT" in
  hafenstadt|dorf|landstrasse|kueste|wald|sumpf|nacht|schenke|ruinen) ;;
  *) echo "Unbekannter Ortstyp: '$ORT'. Erlaubt: hafenstadt dorf landstrasse kueste wald sumpf nacht schenke ruinen" >&2; exit 2 ;;
esac

INHALT="$(ORT="$ORT" ORTNAME="$ORTNAME" HINWEIS="$HINWEIS" python3 - <<'PY'
import json, os, datetime
print(json.dumps({
    "ort": os.environ["ORT"],
    "ortname": os.environ["ORTNAME"],
    "hinweis": os.environ["HINWEIS"],
    "gesetzt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, ensure_ascii=False, indent=2))
PY
)"

SHA="$(gh api "repos/$REPO/contents/$DATEI?ref=$BRANCH" --jq .sha 2>/dev/null || true)"
B64="$(printf '%s\n' "$INHALT" | base64 | tr -d '\n')"

if [ -n "$SHA" ]; then
  gh api -X PUT "repos/$REPO/contents/$DATEI" -f branch="$BRANCH" -f message="Klang: $ORT${ORTNAME:+ ($ORTNAME)}" -f content="$B64" -f sha="$SHA" --jq '.commit.sha' >/dev/null
else
  gh api -X PUT "repos/$REPO/contents/$DATEI" -f branch="$BRANCH" -f message="Klang: $ORT${ORTNAME:+ ($ORTNAME)}" -f content="$B64" --jq '.commit.sha' >/dev/null
fi

echo "Klang gesetzt: $ORT${ORTNAME:+ – $ORTNAME}"
