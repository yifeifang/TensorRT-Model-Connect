"""Qualify actual Whisper transcription on English and Chinese WAV audio."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unicodedata

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'showcase/native'))
from verification_runtime import guarded_command, GpuMonitor  # noqa: E402 - Local helper path is configured first.

def distance(left, right):
    prior = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        row = [i]
        for j, b in enumerate(right, 1):
            row.append(min(row[-1] + 1, prior[j] + 1, prior[j - 1] + (a != b)))
        prior = row
    return prior[-1]

def normalized(text):
    return ''.join(ch.lower() for ch in unicodedata.normalize('NFKC', text)
        if not unicodedata.category(ch).startswith('P')).strip()

receipt = {'model': 'openai/whisper-small', 'inference': 'Actual ModelConnect ITranscription on TensorRT-RTX',
    'passed': False, 'checks': []}
receipt_path = root / 'logs/whisper-small-verification.json'
events = queue.Queue()
env = dict(os.environ)
env['PATH'] = str(root / 'runtime-asr') + os.pathsep + env['PATH']
command = guarded_command(root, [str(root / 'runtime-asr/trtmc_asr_bridge.exe'),
    '--bundle', str(root / 'models/whisper-small-rtx.bundle'),
    '--runtime-root', str(root / 'runtime-asr'), '--runtime-cache', str(root / 'models/whisper-small.rtx.cache')])
monitor = GpuMonitor()
stderr = (root / 'logs/whisper-small-verification.stderr.log').open('w', encoding='utf-8')
process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
    text=True, encoding='utf-8', env=env, creationflags=subprocess.CREATE_NO_WINDOW)

def read_events():
    try:
        for line in process.stdout:
            events.put(json.loads(line))
    except Exception as error:
        events.put(error)
    finally:
        events.put(EOFError('ASR output closed'))

threading.Thread(target=read_events, daemon=True).start()

def receive(expected, timeout=180):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        event = events.get(timeout=max(0.01, until - time.monotonic()))
        if isinstance(event, Exception):
            raise event
        print(json.dumps(event, ensure_ascii=False), flush=True)
        if event['type'] == expected:
            return event
        if event['type'] == 'error':
            raise RuntimeError(event['message'])
    raise TimeoutError(expected)

def send(request):
    process.stdin.write(json.dumps(request, ensure_ascii=False) + '\n')
    process.stdin.flush()

try:
    receipt['ready'] = receive('ready')
    assert receipt['ready']['family'] == 'whisper'
    cases = [
        ('english', 'en', 'english-demo.wav', 'Please send the project report by Friday. The customer meeting is on Monday.'),
        ('chinese', 'zh', 'chinese-funasr.wav', '欢迎大家来体验达摩院推出的语音识别模型。')
    ]
    for name, language, filename, reference in cases:
        request = {'id': name, 'type': 'transcribe', 'language': language, 'maxTokens': 224,
            'wavPath': str(root / 'showcase/asr-native/fixtures' / filename)}
        send(request)
        result = receive('result')
        entry = {'request': request, 'reference': reference, 'result': result, 'passed': False}
        receipt['checks'].append(entry)
        assert result['family'] == 'whisper' and result['id'] == name and not result['truncated']
        assert result['tokens'] > 1 and result['totalMs'] > 0 and result['audioSeconds'] > 0
        assert result['segments'] == [], 'No timestamp segments should be fabricated'
        reference_units = normalized(reference).split() if language == 'en' else list(normalized(reference))
        actual_units = normalized(result['text']).split() if language == 'en' else list(normalized(result['text']))
        error_rate = distance(reference_units, actual_units) / len(reference_units)
        entry['wordErrorRate' if language == 'en' else 'characterErrorRate'] = error_rate
        assert error_rate <= 0.15, f'{name} transcription error rate {error_rate:.3f} exceeds 0.15'
        entry['passed'] = True
    send({'id': 'bad_language', 'type': 'transcribe', 'language': 'xx', 'wavPath': 'unused'})
    receipt['validationError'] = receive('error')
    assert not receipt['validationError']['fatal']
    send({'type': 'stop'})
    receive('stopped')
    receipt['exitCode'] = process.wait(timeout=30)
    assert receipt['exitCode'] == 0
    receipt['passed'] = True
except Exception as error:
    receipt['error'] = repr(error)
    raise
finally:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=30)
    stderr.close()
    receipt['gpuTelemetry'] = monitor.finish()
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
