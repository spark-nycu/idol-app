FROM node:18-slim

WORKDIR /app

# 複製 package.json 檔案
COPY package*.json ./

# 安裝依賴
RUN npm install

# 複製應用程式所有檔案
COPY . .

# 設定環境變數
ENV PORT=8000

# 開放 8000 端口
EXPOSE 8000

# 啟動應用
CMD ["node", "server.js"]