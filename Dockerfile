# Use official Playwright base image with browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

WORKDIR /app

# Copy package files first to leverage caching
COPY package*.json ./

# Install dependencies (including playwright browsers)
RUN npm install

# Copy rest of your app code
COPY . .

# Expose the port your app will run on
ENV PORT=3000
EXPOSE 3000

# Start your app
CMD ["node", "index.js"]
