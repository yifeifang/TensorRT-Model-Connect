"""Download the exact multilingual E5 checkpoint declared by ModelConnect's BERT recipe."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

MODEL = 'intfloat/multilingual-e5-small'
REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
FILES = ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json',
         'special_tokens_map.json', 'sentencepiece.bpe.model', 'sentence_bert_config.json',
         'modules.json', '1_Pooling/config.json', 'README.md']

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
args = parser.parse_args()
sys.stdout.reconfigure(encoding='utf-8')
destination = args.workspace / 'models' / 'e5-small'
os.environ['HF_HOME'] = str(args.workspace / 'models' / 'e5-huggingface')
os.environ['HF_XET_CACHE'] = str(args.workspace / 'models' / 'e5-huggingface' / 'xet')
from huggingface_hub import HfApi, snapshot_download  # noqa: E402 - Configure hub caches before importing.

info = HfApi().model_info(MODEL, revision=REVISION, files_metadata=True)
if info.sha != REVISION:
    raise RuntimeError('The model hub did not resolve the pinned revision')
receipt_path = args.workspace / 'models' / 'e5-small-download.json'
receipt_path.parent.mkdir(parents=True, exist_ok=True)
receipt = {'model': MODEL, 'revision': REVISION, 'complete': False, 'files': []}
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'model': MODEL, 'revision': REVISION, 'destination': str(destination)}), flush=True)
snapshot_download(MODEL, revision=REVISION, local_dir=destination, allow_patterns=FILES)
metadata = {item.rfilename: item for item in info.siblings}
for relative in FILES:
    file = destination / relative
    if not file.is_file():
        raise RuntimeError(f'Missing checkpoint file: {relative}')
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    lfs = metadata[relative].lfs
    if lfs and digest != lfs.sha256:
        raise RuntimeError(f'Checkpoint checksum mismatch: {relative}')
    receipt['files'].append({'path': relative, 'bytes': file.stat().st_size, 'sha256': digest})
config = json.loads((destination / 'config.json').read_text(encoding='utf-8'))
if config.get('model_type') != 'bert' or config.get('hidden_size') != 384:
    raise RuntimeError('Unexpected E5 architecture or embedding dimension')
receipt['complete'] = True
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt), flush=True)
