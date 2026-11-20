#!/bin/sh
# Builds the test IME without Gradle. Adapted from Slate (MIT), playwright/devices/android/ime/build.sh.
set -e
SDK="${ANDROID_HOME:?ANDROID_HOME not set}"
TOOLS="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM="$SDK/platforms/$(ls "$SDK/platforms" | grep -E '^android-[0-9]+$' | sort -V | tail -1)/android.jar"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/.build}"
echo "build-tools: $TOOLS"; echo "platform: $PLATFORM"
rm -rf "$OUT" && mkdir -p "$OUT/classes"
"$TOOLS/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$TOOLS/aapt2" link -I "$PLATFORM" --manifest "$HERE/AndroidManifest.xml" -o "$OUT/unsigned.apk" "$OUT/res.zip"
javac -source 11 -target 11 -nowarn -classpath "$PLATFORM" -d "$OUT/classes" $(find "$HERE/src" -name '*.java')
"$TOOLS/d8" --lib "$PLATFORM" --min-api 26 --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)
"$TOOLS/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
keytool -genkeypair -keystore "$OUT/debug.keystore" -storepass android -keypass android -alias lab -keyalg RSA -validity 10000 -dname "CN=Lab Test" >/dev/null 2>&1
"$TOOLS/apksigner" sign --ks "$OUT/debug.keystore" --ks-pass pass:android --out "$OUT/testime.apk" "$OUT/aligned.apk"
echo "$OUT/testime.apk"
