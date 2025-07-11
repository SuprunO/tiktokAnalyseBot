# Use official Playwright image with all browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

WORKDIR /app

# Install any OS packages if needed (e.g. fonts)
# RUN apt-get update && apt-get install -y fonts-liberation

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY . .

# Expose your bot port
ENV PORT=3000
EXPOSE 3000

# Default command uses xvfb-run to allow headful in headless environments
CMD ["xvfb-run", "-a", "node", "index.js"]
