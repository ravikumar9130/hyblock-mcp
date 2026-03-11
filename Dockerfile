# Use Node.js LTS
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Expose the port Railway will provide
EXPOSE ${PORT}

# Run the server
CMD ["node", "dist/index.js"]
