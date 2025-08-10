# Użyj oficjalnego obrazu Node.js jako bazy
FROM node:18-alpine

# Ustaw katalog roboczy w kontenerze
WORKDIR /app

# Zainstaluj zależności systemowe (ffmpeg) PRZED resztą operacji
RUN apk add --no-cache ffmpeg

# Skopiuj package.json i package-lock.json
COPY package.json ./

#RUN apk add --no-cache ffmpeg
# Zainstaluj zależności
RUN npm install

# Skopiuj resztę kodu aplikacji
COPY . .

# Uruchom serwer za pomocą nodemon dla automatycznego restartu przy zmianach
#CMD [ "npm", "run", "dev" ]
CMD [ "npx", "nodemon", "server.js" ]
