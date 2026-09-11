"""Download and verify the pinned official SAM ViT-base safetensors checkpoint."""
import hashlib
import json
import os
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
workspace = Path(__file__).resolve().parents[2]
os.environ['HF_HOME'] = str(workspace / 'models' / 'huggingface')
os.environ['HF_XET_CACHE'] = str(workspace / 'models' / 'huggingface' / 'xet')
from huggingface_hub import snapshot_download  # noqa: E402 - Configure hub caches before importing.

repo = 'facebook/sam-vit-base'
revision = '70c1a07f894ebb5b307fd9eaaee97b9dfc16068f'
expected_size = 374979480
expected_sha256 = '892c410e496344e527255ccdcb2cb7244a609acb5389c7c4fdba1288f861c579'
receipt = {'repo': repo, 'revision': revision, 'license': 'Apache-2.0', 'downloaded': False}
receipt_path = workspace / 'logs' / 'sam-vit-base-download.json'
receipt_path.parent.mkdir(parents=True, exist_ok=True)
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'repo': repo, 'revision': revision, 'checkpointBytes': expected_size}), flush=True)
destination = Path(snapshot_download(repo, revision=revision, local_dir=workspace / 'models' / 'sam-vit-base',
    allow_patterns=['config.json', 'preprocessor_config.json', 'model.safetensors', 'README.md']))
checkpoint = destination / 'model.safetensors'
if checkpoint.stat().st_size != expected_size:
    raise RuntimeError('Official checkpoint size does not match the pinned source')
with checkpoint.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
if digest != expected_sha256:
    raise RuntimeError('Official checkpoint SHA256 does not match the pinned source')
receipt.update({'downloaded': True, 'sha256': digest,
    'files': [{'path': file.name, 'bytes': file.stat().st_size} for file in destination.iterdir() if file.is_file()]})
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt), flush=True)
