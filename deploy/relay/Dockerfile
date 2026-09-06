FROM alpine:3.20
RUN apk add --no-cache ca-certificates && mkdir -p /data && chown 100:100 /data
COPY dbreader-relay /usr/local/bin/dbreader-relay
USER 100
EXPOSE 8787
VOLUME ["/data"]
ENV TOKEN=""
ENV PORT="8787"
CMD ["sh", "-c", "/usr/local/bin/dbreader-relay --root /data --port ${PORT} ${TOKEN:+--token ${TOKEN}}"]
