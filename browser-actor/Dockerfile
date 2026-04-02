FROM node:20-slim

# System dependencies for Camoufox (Firefox) + Xvfb virtual display
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer cache.
COPY package.json ./

# Install NPM packages fresh (ignore lockfile to get correct native binaries for this platform)
RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Download Camoufox browser binary
RUN npx camoufox fetch

# Copy the remaining files with the source code.
COPY . ./

# Xvfb (virtual display) required for headed Camoufox with humanize: true
# Xvfb + VNC + noVNC for browser viewing, then start the actor
CMD ["sh", "-c", "rm -f /tmp/.X99-lock && Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp & while ! xdpyinfo -display :99 >/dev/null 2>&1; do sleep 0.5; done && echo 'Xvfb ready on :99' && x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -bg && websockify --web /usr/share/novnc 6080 localhost:5900 & DISPLAY=:99 npm start --silent"]
