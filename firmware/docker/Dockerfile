FROM node:22-slim

RUN npm install -g xs-dev

# 必要なパッケージをインストール
RUN apt-get update && \
    apt-get install sudo python3-venv -y && \
    apt-get clean && \
    apt-get autoremove

# node ユーザーにパスワードなしの sudo 権限を付与
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER node

# xs-dev をセットアップ
RUN CI=true xs-dev setup
RUN . /home/node/.local/share/xs-dev-export.sh && \
    CI=true xs-dev setup --device=esp32

# 必要な環境変数をロード
RUN echo ". /home/node/.local/share/xs-dev-export.sh" >> ~/.bashrc

# 作業ディレクトリの設定
WORKDIR /workspace
