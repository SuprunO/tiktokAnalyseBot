# ✅ Use official Playwright image with Chromium preinstalled
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# Set working directory
WORKDIR /app

# Copy only package.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your app
COPY . .

# Set environment
ENV PORT=3000
EXPOSE 3000

# Start your Telegram bot (adjust if you use another file)
CMD ["node", "index.js"]
