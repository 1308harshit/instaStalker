FROM node:18-slim

WORKDIR /app/backend

RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libxss1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcups2 \
    libxcomposite1 \
    libxdamage1 \
    libasound2 \
    libxrandr2 \
    libx11-xcb1 \
    libxfixes3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./

RUN npm install

RUN npx playwright install chromium

COPY backend .

EXPOSE 3000

CMD ["npm", "start"]
