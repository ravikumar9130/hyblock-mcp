# --------- Stage 1: Build ---------
FROM node:20-slim AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including typescript)
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# --------- Stage 2: Production ---------
FROM node:20-slim
WORKDIR /app

# Set to production mode
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies!
RUN npm ci --omit=dev

# Copy the compiled "dist" folder from the builder stage
COPY --from=builder /app/dist ./dist

# Railway will inject its own PORT, but setting a default is fine
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
