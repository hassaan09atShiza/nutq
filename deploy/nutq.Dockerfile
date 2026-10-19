# Nutq's dev server (vite) as a container, for the compose baseline in this folder. It serves the same page as
# `npm run dev`, eval mode included. The build context is the repository root (see compose.yaml).

# The official node image, pinned by digest. public.ecr.aws mirrors Docker Hub's library images; it is used because
# anonymous Docker Hub pulls can be rate limited (429). The same digest is on docker.io/library/node.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
FROM ${NODE_IMAGE}

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
# extra_ca is an optional build secret: the CA of a proxy that re-signs outbound HTTPS (compose.cloud.yaml passes it).
# A secret is used so the CA never becomes part of an image layer.
RUN --mount=type=secret,id=extra_ca,required=false,uid=1000 \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund

COPY --chown=node:node . .

EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5173/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
