FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY patches ./patches/
COPY prisma ./prisma/
RUN npm ci

# Copy the rest of the application files
COPY . .

# Generate Prisma client and build Next.js application
RUN npx prisma generate
RUN npm run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

# Copy production files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=3003
ENV HOSTNAME=0.0.0.0
EXPOSE 3003

CMD ["sh", "-c", "npx prisma migrate deploy && (if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && npx tsx src/server/index.ts"]
