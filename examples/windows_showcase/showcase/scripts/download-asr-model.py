"""Download the pinned multilingual Whisper checkpoint into this worktree."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--revision', default='973afd24965f72e36ca33b3055d56a652f456b4d')
args = parser.parse_args()
os.environ['HF_HOME'] = str(args.workspace / 'models/huggingface')
os.environ['HF_XET_CACHE'] = str(args.workspace / 'models/huggingface/xet')
from huggingface_hub import HfApi, snapshot_download  # noqa: E402 - Configure hub caches before importing.

repo = 'openai/whisper-small'
revision = HfApi().model_info(repo, revision=args.revision).sha
receipt = {'repo': repo, 'revision': revision, 'downloaded': False}
receipt_path = args.workspace / 'logs/whisper-small-download.json'
receipt_path.parent.mkdir(parents=True, exist_ok=True)
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt), flush=True)
destination = Path(snapshot_download(repo, revision=revision,
    local_dir=args.workspace / 'models/Whisper-small',
    allow_patterns=['*.json', '*.safetensors', '*.txt', 'LICENSE', 'README.md']))
receipt['files'] = [{'path': str(path.relative_to(destination)), 'bytes': path.stat().st_size}
    for path in destination.iterdir() if path.is_file()]
receipt['downloaded'] = True
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt), flush=True)
