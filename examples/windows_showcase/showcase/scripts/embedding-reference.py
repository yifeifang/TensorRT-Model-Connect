"""Generate a pinned E5 CPU reference; never initialize a CUDA model."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
args = parser.parse_args()
workspace = args.workspace.resolve()
sys.path[:0] = [str(workspace / 'models' / 'e5-python-deps'), str(workspace / 'python-deps')]
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['CUDA_VISIBLE_DEVICES'] = ''
sys.stdout.reconfigure(encoding='utf-8')
import torch  # noqa: E402 - Configure CPU-only execution and dependency paths first.
from transformers import AutoModel, AutoTokenizer  # noqa: E402 - Configure offline model loading first.

texts = [
    '如何在没有网络的情况下处理私人会议录音？',
    'Local speech recognition transcribes meeting audio on the device without uploading recordings.',
    'The online weather forecast predicts rain and strong wind tomorrow.',
    'Our calendar lets a team schedule calls and book meeting rooms.',
    'Find a recipe for pumpkin soup.',
    '南瓜去皮切块，加洋葱和高汤煮软，再打成细腻的浓汤。',
    'A graphics card accelerates neural network inference on the desktop.',
    '如何在没有网络的情况下处理私人会议录音？',
]
roles = ['query', 'passage', 'passage', 'passage', 'query', 'passage', 'passage', 'query']
model_inputs = [f'{role}: {text}' for role, text in zip(roles, texts)]
tokenizer = AutoTokenizer.from_pretrained(workspace / 'models' / 'e5-small', local_files_only=True)
model = AutoModel.from_pretrained(workspace / 'models' / 'e5-small', local_files_only=True, attn_implementation='eager').eval().float().to('cpu')
torch.set_num_threads(4)
batch = tokenizer(model_inputs, padding=True, truncation=False, return_tensors='pt')
assert all(tensor.device.type == 'cpu' for tensor in batch.values())
assert next(model.parameters()).device.type == 'cpu'
started = time.perf_counter()
with torch.inference_mode():
    hidden = model(**batch).last_hidden_state
    hidden = hidden.masked_fill(~batch['attention_mask'][..., None].bool(), 0.0)
    pooled = hidden.sum(dim=1) / batch['attention_mask'].sum(dim=1)[..., None]
    vectors = torch.nn.functional.normalize(pooled, p=2, dim=1)
result = {'model': 'intfloat/multilingual-e5-small', 'revision': '614241f622f53c4eeff9890bdc4f31cfecc418b3',
          'reference': 'Hugging Face AutoModel FP32 on CPU', 'texts': texts, 'roles': roles,
          'modelInputs': model_inputs, 'vectors': vectors.tolist(),
          'tokenCounts': batch['attention_mask'].sum(dim=1).tolist(),
          'similarities': (vectors @ vectors.T).tolist(), 'totalMs': (time.perf_counter() - started) * 1000}
output = workspace / 'models' / 'e5-cpu-reference.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'reference': str(output), 'dimension': vectors.shape[1], 'rows': vectors.shape[0],
                  'tokenCounts': result['tokenCounts'], 'totalMs': result['totalMs'],
                  'chineseQueryScores': result['similarities'][0][1:4],
                  'englishQueryToChineseRecipe': result['similarities'][4][5]}, ensure_ascii=False), flush=True)
