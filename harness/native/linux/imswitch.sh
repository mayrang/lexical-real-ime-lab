#!/bin/bash
# usage: imswitch.sh ko|ja|zh|en   (needs IME_ENGINE=ibus|fcitx5, set by env.sh)
case "$IME_ENGINE:$1" in
  ibus:ko) ibus engine hangul;;
  ibus:ja) ibus engine mozc-jp;;
  ibus:zh) ibus engine libpinyin;;
  ibus:en) ibus engine xkb:us::eng;;
  fcitx5:ko) fcitx5-remote -o; fcitx5-remote -s hangul;;
  fcitx5:ja) fcitx5-remote -o; fcitx5-remote -s mozc;;
  fcitx5:zh) fcitx5-remote -o; fcitx5-remote -s pinyin;;
  fcitx5:en) fcitx5-remote -s keyboard-us;;
  *) echo "imswitch: unknown $IME_ENGINE:$1" >&2; exit 2;;
esac
exit 0
