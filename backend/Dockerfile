FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for Prisma and native extensions
RUN apk add --no-cache openssl openssl-dev libc6-compat

# Copy package and lock files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies and generate Prisma client
RUN npm ci
RUN npx prisma generate

# Copy application code
COPY . .

# Start a new stage for a smaller production image
FROM node:20-alpine AS production

WORKDIR /app

# Required for Prisma
RUN apk add --no-cache openssl openssl-dev libc6-compat

# Copy node_modules, generated Prisma client, and built source code from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

# Set production environment
ENV NODE_ENV=production

# Expose port (default 3000, but railway uses PORT env variable)
EXPOSE 3000

# Start application
CMD ["npm", "start"]
