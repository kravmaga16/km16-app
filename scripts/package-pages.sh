#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
 echo 'Usage: scripts/package-pages.sh OUTPUT.tar [COMMIT]' >&2
 exit 2
fi

commit=$(git rev-parse --verify "${2:-HEAD}^{commit}")
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
files=()
while IFS= read -r -d '' file; do
 case "$file" in
  vendor/*.js|vendor/*LICENSE*|CNAME) files+=("$file"); continue ;;
  */*) continue ;;
  *.html|*.js|*.mjs|*.css|*.json|*.webmanifest|*.xml|*.txt|*.png|*.jpg|*.jpeg|*.webp|*.svg|*.ico|*.pdf)
   [[ "$file" == LISEZ-MOI.txt ]] || files+=("$file") ;;
 esac
done < <(git ls-tree -rz --name-only "$commit")
git archive --format=tar "$commit" -- "${files[@]}" > "$tmp"
for required in index.html CNAME manifest.webmanifest sw.js clients.html clients.mjs club-payments.mjs; do
 tar -tf "$tmp" "$required" >/dev/null
done
[[ $(tar -xOf "$tmp" CNAME) == app.km16.fr ]]
mv "$tmp" "$1"
printf '%s\n' "$commit"
