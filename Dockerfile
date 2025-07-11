# Офіційний Playwright-імідж з усіма браузерами
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

WORKDIR /app

# (Опційно) Додати системні пакети
# RUN apt-get update && apt-get install -y fonts-liberation

# Копіюємо package-файли для кешу
COPY package*.json ./

# Встановлюємо лише продакшн-залежності
RUN npm ci --only=production

# Копіюємо увесь код
COPY . .

# Робимо entrypoint.sh виконуваним
RUN chmod +x /app/entrypoint.sh

# Виставляємо змінні середовища
ENV PORT=3000
EXPOSE 3000

# Запускаємо скрипт
ENTRYPOINT ["/app/entrypoint.sh"]
