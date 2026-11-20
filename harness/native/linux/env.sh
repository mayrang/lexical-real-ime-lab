# usage: source env.sh ibus|fcitx5
# Starts Xvfb :99, dbus, openbox and the IME daemon with every engine configured.
# Switch engines with imswitch.sh <ko|ja|zh|en>.
export DISPLAY=:99 LANG=en_US.UTF-8 LC_ALL=C.UTF-8 IME_ENGINE=$1
Xvfb :99 -screen 0 1280x900x24 >/tmp/xvfb.log 2>&1 & sleep 1
eval $(dbus-launch --sh-syntax); export DBUS_SESSION_BUS_ADDRESS
openbox >/tmp/openbox.log 2>&1 & sleep 1
mkdir -p ~/.config/mozc
if [ "$1" = fcitx5 ]; then
  export GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx
  mkdir -p ~/.config/fcitx5/conf
  printf '[Groups/0]\nName=Default\nDefault Layout=us\nDefaultIM=hangul\n[Groups/0/Items/0]\nName=keyboard-us\nLayout=\n[Groups/0/Items/1]\nName=hangul\nLayout=\n[Groups/0/Items/2]\nName=mozc\nLayout=\n[Groups/0/Items/3]\nName=pinyin\nLayout=\n[GroupOrder]\n0=Default\n' > ~/.config/fcitx5/profile
  printf 'InitialMode=Hiragana\n' > ~/.config/fcitx5/conf/mozc.conf
  # pinyin: no cloud, no prediction surprises
  printf 'CloudPinyinEnabled=False\n' > ~/.config/fcitx5/conf/pinyin.conf
  fcitx5 -d >/tmp/fcitx5.log 2>&1; sleep 2
  fcitx5-remote -n
elif [ "$1" = ibus ]; then
  export GTK_IM_MODULE=ibus QT_IM_MODULE=ibus XMODIFIERS=@im=ibus
  gsettings set org.freedesktop.ibus.engine.hangul initial-input-mode 'hangul' 2>&1 || true
  printf 'engines {\n  name : "mozc-jp"\n  longname : "Mozc"\n  layout : "default"\n  layout_variant : ""\n  layout_option : ""\n  rank : 80\n}\nactive_on_launch: True\n' > ~/.config/mozc/ibus_config.textproto
  ibus-daemon -drx >/tmp/ibus.log 2>&1; sleep 3
  ibus engine hangul; ibus engine
else
  echo "env.sh: engine must be ibus or fcitx5" >&2; return 2
fi
