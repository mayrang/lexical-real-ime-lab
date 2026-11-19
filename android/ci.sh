#!/bin/bash
# Runs inside reactivecircus/android-emulator-runner after the emulator booted.
# usage: android/ci.sh <label> <lexical:yes|no> <repeats> <scenario...>
set -u
LABEL=$1; LEX=$2; REP=$3; shift 3
echo "emulator ready at $(date -u +%T)"
adb shell getprop ro.build.version.release
adb shell getprop ro.build.type
adb shell dumpsys package com.android.chrome | grep -m2 -E 'versionName|versionCode' || echo "NO CHROME PACKAGE"
adb install -r android/ime/.build/testime.apk
adb shell ime list -s
node android/run.mjs out "$LABEL" control "$REP" "$@" 2>&1 | tee -a out/run.log
if [ "$LEX" = yes ]; then
  node android/run.mjs out "$LABEL" lexical "$REP" "$@" 2>&1 | tee -a out/run.log
fi
adb exec-out screencap -p > out/screen-end.png || true
echo "done at $(date -u +%T)"
