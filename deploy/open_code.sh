#!/usr/bin/env bash
# DBReader cloud backend: build musl Lambda zips + deploy via AWS CDK.
# Usage: ./open_code.sh [--bootstrap] [--skip-build] [--arch arm64|x86_64]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY="$ROOT/cloud-relay"
INFRA="$RELAY/infra"
ARCH="${ARCH:-aarch64}"

if ! command -v aws >/dev/null; then
  echo "error: aws CLI not found (brew install awscli)" >&2
  exit 1
fi
if ! command -v cargo >/dev/null; then
  echo "error: cargo not found" >&2
  exit 1
fi

aws sts get-caller-identity >/dev/null 2>&1 || {
  echo "error: not authenticated with AWS (run 'aws login')" >&2
  exit 1
}
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo ap-southeast-2)}}"
echo "> region: $REGION"
export AWS_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_REGION="$REGION"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "> building Lambda zips (musl $ARCH)..."
  (
    cd "$RELAY"
    cargo test >/dev/null
    cargo build --release --target "$ARCH-unknown-linux-musl"
    mkdir -p dist
    cp "target/$ARCH-unknown-linux-musl/release/dbreader-cloud" dist/bootstrap
    chmod +x dist/bootstrap
    (cd dist && zip -q bootstrap.zip bootstrap && rm bootstrap)
  )
  echo "> dist/bootstrap.zip: $(du -h "$RELAY/dist/bootstrap.zip" | cut -f1)"
fi

if ! command -v node >/dev/null; then
  echo "error: node not found" >&2
  exit 1
fi

if [[ ! -d "$INFRA/node_modules" ]]; then
  echo "> installing infra deps..."
  (cd "$INFRA" && npm install --no-fund --no-audit)
fi

if [[ "${1:-}" == "--bootstrap" ]]; then
  echo "> bootstrapping CDK..."
  npx --prefix "$INFRA" cdk bootstrap aws://"$(aws sts get-caller-identity --query Account --output text)"/"$REGION"
fi

echo "> deploying..."
(cd "$INFRA" && npx cdk deploy --require-approval never --outputs-file /tmp/dbreader-cdk-outputs.json)

echo
echo "======================================================================"
echo " Deployed. API URL:"
python3 - <<'PY' 2>/dev/null || true
import json
with open('/tmp/dbreader-cdk-outputs.json') as f:
    out = json.load(f)
for stack, vals in out.items():
    for k, v in vals.items():
        print(f"   {k}: {v}")
PY
echo "======================================================================"
