# Use official Node.js + system dependencies for Chromium
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all source files
COPY . .

# Set environment variable to disable telemetry
ENV CI=true

# Expose the port your app will run on
ENV PORT=3000
EXPOSE 3000

# Start your bot server
CMD ["node", "index.js"]
