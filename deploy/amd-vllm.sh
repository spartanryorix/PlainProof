#!/usr/bin/env bash
# Start an OpenAI-compatible vLLM server for PlainProof on an AMD Developer Cloud GPU droplet (Instinct MI300X, ROCm).
# Run this ON the droplet. PlainProof then talks to http://<droplet-ip>:8000/v1 (set LLM_BASE_URL in .env).
#
#   VLLM_API_KEY=$(openssl rand -hex 24) ./amd-vllm.sh
#
# Optional: MODEL=google/gemma-3-27b-it HF_TOKEN=hf_... (gated, multimodal: enables photo input on the GPU)
set -euo pipefail

MODEL="${MODEL:-Qwen/Qwen2.5-32B-Instruct}"
PORT="${PORT:-8000}"
IMAGE="${IMAGE:-rocm/vllm:latest}"
MAX_LEN="${MAX_LEN:-32768}"
: "${VLLM_API_KEY:?Set VLLM_API_KEY to a long random string. The same value goes in LLM_API_KEY in PlainProof's .env}"

docker rm -f plainproof-vllm >/dev/null 2>&1 || true

docker run -d --name plainproof-vllm --restart unless-stopped \
  --device /dev/kfd --device /dev/dri --group-add video \
  --ipc host --security-opt seccomp=unconfined \
  -p "${PORT}:8000" \
  -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
  -e HF_TOKEN="${HF_TOKEN:-}" \
  --entrypoint /bin/bash "${IMAGE}" -lc \
  "vllm serve '${MODEL}' --host 0.0.0.0 --port 8000 --api-key '${VLLM_API_KEY}' --max-model-len ${MAX_LEN}"

echo "Starting ${MODEL}. The first start downloads the weights; follow it with:"
echo "  docker logs -f plainproof-vllm"
echo "Ready when this returns the model name:"
echo "  curl -s -H 'Authorization: Bearer ${VLLM_API_KEY}' http://localhost:${PORT}/v1/models"
