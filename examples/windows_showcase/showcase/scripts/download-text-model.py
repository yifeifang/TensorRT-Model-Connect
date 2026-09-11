"""Download a pinned public Qwen checkpoint into the isolated demo workspace."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', default='Qwen3-4B', choices=['Qwen3-0.6B', 'Qwen3-1.7B', 'Qwen3-4B', 'Qwen3-4B-Instruct-2507'])
parser.add_argument('--revision', required=True, help='Exact 40-character checkpoint commit to acquire')
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
args = parser.parse_args()
if len(args.revision) != 40 or any(char not in '0123456789abcdef' for char in args.revision):
    parser.error('--revision must be a full lowercase 40-character commit')
os.environ['HF_HOME'] = str(args.workspace / 'models' / 'huggingface')
os.environ['HF_XET_CACHE'] = str(args.workspace / 'models' / 'huggingface' / 'xet')
from huggingface_hub import HfApi, snapshot_download  # noqa: E402 - Configure hub caches before importing.

repo = f'Qwen/{args.model}'
info = HfApi().model_info(repo, revision=args.revision)
revision = info.sha
receipt = {'repo': repo, 'revision': revision, 'files': [], 'downloaded': False}
receipt_path = args.workspace / 'logs' / f'{args.model.lower()}-download.json'
receipt_path.parent.mkdir(parents=True, exist_ok=True)
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'repo': repo, 'revision': revision}), flush=True)
destination = Path(snapshot_download(repo, revision=revision, local_dir=args.workspace / 'models' / args.model,
    allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model', 'LICENSE', 'README.md']))
receipt['files'] = [{'path': str(path.relative_to(destination)), 'bytes': path.stat().st_size}
    for path in destination.iterdir() if path.is_file()]
receipt['downloaded'] = True
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt), flush=True)
