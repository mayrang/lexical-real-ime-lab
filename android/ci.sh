#!/bin/bash
# Runs inside reactivecircus/android-emulator-runner after the emulator booted.
# usage: android/ci.sh <label> <lexical:yes|no> <repeats> <scenario...>
set -u
LABEL=$1; LEX=$2; REP=$3; shift 3
echo "emulator ready at $(date -u +%T)"
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
sleep 20
adb shell getprop ro.build.version.release
adb shell getprop ro.build.type
adb shell dumpsys package com.android.chrome | grep -m2 -E 'versionName|versionCode' || echo "NO CHROME PACKAGE"
adb install -r android/ime/.build/testime.apk
for i in $(seq 1 60); do adb shell ime list -a -s 2>/dev/null | grep -q lexicallab && break; sleep 2; done
adb shell ime list -a -s
node android/run.mjs out "$LABEL" control "$REP" "$@" 2>&1 | tee -a out/run.log
if [ "$LEX" = yes ]; then
  node android/run.mjs out "$LABEL" lexical "$REP" "$@" 2>&1 | tee -a out/run.log
fi
adb exec-out screencap -p > out/screen-end.png || true
echo "done at $(date -u +%T)"
