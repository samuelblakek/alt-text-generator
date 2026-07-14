FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r appgroup && useradd -r -g appgroup -u 1000 appuser
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
RUN mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start", "--", "-p", "8080"]
