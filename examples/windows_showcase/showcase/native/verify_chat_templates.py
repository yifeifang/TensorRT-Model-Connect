"""Compare native chat formatting with each checkpoint's actual Jinja template."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'python-deps'))
from jinja2 import Environment  # noqa: E402 - Local dependency path is configured first.

fixtures = []
for model in ['Qwen3-0.6B', 'Qwen3-4B', 'Qwen3-4B-Instruct-2507']:
    config_path = root / 'models' / model / 'tokenizer_config.json'
    if not config_path.is_file() and model != 'Qwen3-4B-Instruct-2507':
        print(f'Skipping optional historical checkpoint: {model}')
        continue
    config = json.loads(config_path.read_text(encoding='utf-8'))
    prompt = 'Explain local inference in one sentence.'
    template = config['chat_template']
    rendered = Environment().from_string(template).render(messages=[{'role': 'user', 'content': prompt}],
        add_generation_prompt=True, enable_thinking=False, tools=None)
    fixtures.append({'model': model, 'prompt': prompt, 'template': template, 'expected': rendered})
fixture_path = root / 'logs' / 'chat-template-fixtures.json'
fixture_path.parent.mkdir(parents=True, exist_ok=True)
fixture_path.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2), encoding='utf-8')
env = dict(os.environ)
env['PATH'] = str(root / 'runtime-text') + os.pathsep + env['PATH']
subprocess.run([str(root / 'showcase/build-text-isolated/trtmc/test_showcase_chat_template.exe'), str(fixture_path)],
    check=True, env=env)
