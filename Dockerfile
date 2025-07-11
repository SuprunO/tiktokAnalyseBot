# Офіційний Playwright-імідж з усіма браузерами
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

WORKDIR /app

# (Опційно) Встановити додаткові шрифти чи пакети
# RUN apt-get update && apt-get install -y fonts-liberation

# Копіюємо package файли окремо для кешу
COPY package*.json ./

# Встановлюємо тільки продакшн-залежності
RUN npm ci --only=production

# Копіюємо увесь код
COPY . .

# Встановлюємо порт (Render вимагає його)
ENV PORT=3000
EXPOSE 3000

# Основна команда через xvfb-run (для headful у headless середовищі)
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24", "node", "index.js"]
