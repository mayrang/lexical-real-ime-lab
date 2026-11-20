#!/bin/bash
# Runs inside reactivecircus/android-emulator-runner after the emulator booted.
# The playground (port 3013) and the control page (port 3014) are already served on the host.
# usage: harness/native/android/ci.sh <groups,comma,list> <reps> [scen]
# Env: LEXICAL_URL, LEXICAL_COMMIT, ANDROID_SYSTEM_IMAGE, ANDROID_LOG_DIR.
set -u
GROUPS_ARG=$1; REPS=$2; SCEN=${3:-}
LOGS=${ANDROID_LOG_DIR:-logs}
mkdir -p records "$LOGS"
echo "emulator ready at $(date -u +%T)"
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
sleep 20
adb shell getprop ro.build.version.release
adb shell getprop ro.build.fingerprint
adb shell dumpsys package com.android.chrome | grep -m2 -E 'versionName|versionCode' || echo "NO CHROME PACKAGE"
adb install -r harness/native/android/ime/.build/testime.apk
for i in $(seq 1 60); do adb shell ime list -a -s 2>/dev/null | grep -q lexicallab && break; sleep 2; done
adb shell ime list -a -s
IFS=, read -r -a GS <<< "${GROUPS_ARG// /}"
for g in "${GS[@]}"; do
  node harness/run.mjs --os android --group "$g" --reps "$REPS" --langs ko \
    --lexical-url "$LEXICAL_URL" --lexical-commit "$LEXICAL_COMMIT" --out records ${SCEN:+--scen "$SCEN"} 2>&1 | tee -a "$LOGS/run.log"
done
ls records | wc -l
adb logcat -d -t 2000 > "$LOGS/logcat-end.txt" 2>/dev/null || true
adb exec-out screencap -p > "$LOGS/screen-end.png" || true
echo "done at $(date -u +%T)"
