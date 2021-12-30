FROM meganetaaan/moddable-esp32:moddable-db8f973
LABEL maintainer "Shinya Ishikawa<ishikawa.s.1027@gmail.com>"

RUN curl -SL https://deb.nodesource.com/setup_14.x | bash \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g typescript
RUN echo ". /opt/esp/idf/export.sh" >> /root/.bashrc
