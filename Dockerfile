FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY oracle-wallet ./oracle-wallet
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/oracle-wallet ./oracle-wallet

# Install only production dependencies
RUN npm ci --omit=dev

# Fly.io exposes PORT environment variable automatically
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start:mcp"]
