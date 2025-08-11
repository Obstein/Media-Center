# Użyj oficjalnego obrazu Node.js jako bazy
FROM node:18-alpine

# Zainstaluj Pythona i pip
RUN apk add --no-cache python3 py3-pip

# Ustaw katalog roboczy w kontenerze
WORKDIR /app

# Skopiuj pliki package.json i package-lock.json (jeśli istnieje)
COPY package*.json ./

# Zainstaluj zależności npm
RUN npm install

# Zainstaluj zależności Pythona, omijając zabezpieczenie systemowe
RUN pip3 install requests --break-system-packages

# Skopiuj resztę kodu aplikacji
COPY . .

# Uruchom serwer za pomocą skryptu z package.json
CMD [ "npm", "run", "dev" ]
