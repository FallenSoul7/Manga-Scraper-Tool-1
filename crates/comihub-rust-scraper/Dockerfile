FROM rust:1-slim-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/comihub-rust-scraper /usr/local/bin/comihub-rust-scraper
ENV PORT=10000
EXPOSE 10000
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/comihub-rust-scraper"]
