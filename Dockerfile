# Node, Chromium (for PDF receipts) and fonts for Arabic and Tamil in one image.
FROM mcr.microsoft.com/playwright:v1.55.1-noble
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build
ENV NODE_ENV=production DATA_DIR=/data HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
