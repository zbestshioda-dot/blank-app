#!/bin/sh
# Render the background-music loops and encode them for the client.
set -e
TMP=$(mktemp -d)
python3 tools/music/compose.py "$TMP"
mkdir -p public/assets/music
for f in day night; do
  # static gain to -16 LUFS (a dynamic normaliser would break the loop seam)
  I=$(ffmpeg -hide_banner -nostats -i "$TMP/$f.wav" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | awk '/I:/{print $2}')
  G=$(python3 -c "print(round(-16-($I),2))")
  ffmpeg -hide_banner -loglevel error -y -i "$TMP/$f.wav" -af "volume=${G}dB" -c:a libmp3lame -b:a 112k "public/assets/music/$f.mp3"
done
rm -rf "$TMP"
