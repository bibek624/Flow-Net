# Works on any host that runs containers (Fly.io, Koyeb, Railway, Hugging Face Spaces, a VPS).
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production PORT=3000 DATA_DIR=/srv/data UPLOAD_DIR=/srv/uploads
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
