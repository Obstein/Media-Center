# Użyj oficjalnego obrazu Node.js jako bazy
FROM node:18-alpine

# Ustaw katalog roboczy w kontenerze
WORKDIR /app

# Skopiuj package.json i package-lock.json
COPY package.json ./

# Zainstaluj zależności
RUN npm install

# Skopiuj resztę kodu aplikacji
COPY . .

# Uruchom serwer deweloperski React
CMD ["npm", "start"]
