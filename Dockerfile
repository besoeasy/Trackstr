# Build stage
FROM docker.io/library/node:22-alpine AS builder

WORKDIR /app

# Install dependencies using clean install
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build production assets
COPY . .
RUN npm run build

# Production serve stage
FROM docker.io/library/nginx:alpine AS runner

# Use custom nginx configuration with SPA fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
