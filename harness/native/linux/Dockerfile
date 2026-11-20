# Real-IME Linux image: Playwright browsers + Xvfb/openbox/xdotool + ibus and fcitx5 with
# Korean (hangul), Japanese (mozc) and Chinese (pinyin) engines. Ported from the spike
# (tools/real-ime-spike/linux and matrix Dockerfiles).
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb openbox dbus-x11 xdotool x11-utils \
    ibus ibus-gtk3 ibus-gtk4 ibus-hangul ibus-mozc mozc-server ibus-libpinyin \
    fcitx5 fcitx5-frontend-gtk3 fcitx5-frontend-gtk4 fcitx5-config-qt- \
    fcitx5-hangul fcitx5-mozc fcitx5-chinese-addons fcitx5-pinyin \
    fonts-noto-cjk procps curl libglib2.0-bin dconf-cli dconf-gsettings-backend \
    && rm -rf /var/lib/apt/lists/*
