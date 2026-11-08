# George's Nappies: production image (website + web app + API + WebSockets in one service).

# 1) Build the web app
FROM node:20.18.1-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Python runtime
FROM python:3.13.1-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ENVIRONMENT=production
WORKDIR /srv
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=web /web/dist ./frontend/dist
RUN useradd --create-home --uid 10001 nappies && mkdir -p /var/data && chown -R nappies /srv /var/data
USER nappies
WORKDIR /srv/backend
EXPOSE 8000
# Render sets $PORT. Proxy headers let rate limits see real client IPs behind Render's proxy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
