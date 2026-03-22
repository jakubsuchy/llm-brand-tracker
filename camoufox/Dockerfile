FROM node:20-slim

# Install Firefox/Camoufox dependencies + Xvfb + VNC + noVNC/websockify
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libasound2 \
    libpci3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    fonts-liberation \
    fonts-noto-color-emoji \
    xvfb \
    x11vnc \
    x11-utils \
    novnc \
    websockify \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install camoufox-js and fetch the browser binary
RUN npm init -y && npm install camoufox-js crawlee playwright otpauth
RUN npx camoufox fetch

# Server + providers
COPY server.mjs .
COPY providers ./providers

EXPOSE 8888
EXPOSE 5900
EXPOSE 6080

# Xvfb (virtual display) + x11vnc (VNC server) + websockify+noVNC (web VNC on 6080) + camoufox server
CMD ["sh", "-c", "rm -f /tmp/.X99-lock && Xvfb :99 -screen 0 1280x720x24 -ac -nolisten tcp & while ! xdpyinfo -display :99 >/dev/null 2>&1; do sleep 0.5; done && echo 'Xvfb ready on :99' && x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -bg && websockify --web /usr/share/novnc 6080 localhost:5900 & DISPLAY=:99 node server.mjs"]
