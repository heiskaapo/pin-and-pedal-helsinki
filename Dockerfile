FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
ENV PORT=8080
USER node
CMD ["node", "server.js"]
