# Base image with Chromium + dependencies
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# Create working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Ensure Playwright dependencies & Chromium are installed
RUN npx playwright install chromium --with-deps

# Default environment & port
ENV PORT=3000
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
