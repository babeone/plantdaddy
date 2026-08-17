#!/bin/sh
# Backup delle foto verso un bucket esterno (Cloudflare R2, o qualunque S3).
#
# PERCHÉ SERVE, e perché non è come il backup del database: le foto NON si
# rigenerano. Uno storico di annaffiature perso si può ricostruire a mano, una
# foto di due anni fa no. Se il disco della VPS muore senza una copia altrove,
# quelle immagini sono perse per sempre.
#
# Perché R2 come destinazione: l'egress è gratuito, quindi il giorno del
# ripristino — l'unico in cui si scarica tutto — non arriva una bolletta.
#
# `mc mirror` copia solo le differenze, quindi dal secondo giro in poi trasferisce
# soltanto le foto nuove. --remove propaga anche le cancellazioni, così il backup
# non cresce per sempre con foto che l'utente ha eliminato; togliere quel flag
# trasforma il backup in un archivio storico, che è una scelta diversa e più cara.
#
# USO, dalla shell del VPS:
#   MC="docker run --rm --network dokploy-network \
#     -e SRC_KEY -e SRC_SECRET -e DST_KEY -e DST_SECRET \
#     quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z"
#   ...oppure si copia questo script dentro un container mc e si lancia.
#
# In Dokploy: Schedules -> nuovo job, una volta al giorno, Shell = sh.
set -e

: "${SRC_ALIAS_URL:=http://plantdaddy-minio:9000}"
: "${SRC_BUCKET:=plantdaddy}"
: "${DST_BUCKET:?DST_BUCKET non impostata}"
: "${DST_ENDPOINT:?DST_ENDPOINT non impostata (es. https://<account>.r2.cloudflarestorage.com)}"

mc alias set origine "$SRC_ALIAS_URL" "$SRC_KEY" "$SRC_SECRET"
mc alias set destinazione "$DST_ENDPOINT" "$DST_KEY" "$DST_SECRET"

echo "avvio mirror $SRC_BUCKET -> $DST_BUCKET"
mc mirror --overwrite --remove "origine/$SRC_BUCKET" "destinazione/$DST_BUCKET"

# Conteggio a valle: se i due numeri divergono molto, il mirror non ha finito.
echo "origine:     $(mc ls --recursive "origine/$SRC_BUCKET" | wc -l) oggetti"
echo "destinazione: $(mc ls --recursive "destinazione/$DST_BUCKET" | wc -l) oggetti"
echo "spazio usato in origine:"
mc du "origine/$SRC_BUCKET"
