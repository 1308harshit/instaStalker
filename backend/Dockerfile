FROM node:18-slim

# Install system dependencies for Playwright
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Install Playwright browsers (this will persist in the image)
RUN npx playwright install chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]

