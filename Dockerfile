# Nightshift: headless Claude Code agents on a schedule.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends zsh git curl jq tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/nightshift
COPY package*.json tsconfig*.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
# The Agent SDK brings Claude Code for this platform as an optional dependency.
RUN npm run build && npm prune --omit=dev && npm cache clean --force \
 && chmod +x dist/cli.js \
 && ln -s /opt/nightshift/dist/cli.js /usr/local/bin/nightshift

# Mount points. Claude Code keeps its session files in /home/node/.claude.
RUN mkdir -p /agents /workspaces /state /home/node/.claude \
 && chown node:node /state /workspaces /home/node/.claude

ENV HOME=/home/node NODE_ENV=production
USER node
WORKDIR /workspaces

ENTRYPOINT ["nightshift"]
CMD ["daemon", "--agents", "/agents", "--state", "/state", "--secrets", "/run/secrets.env"]
