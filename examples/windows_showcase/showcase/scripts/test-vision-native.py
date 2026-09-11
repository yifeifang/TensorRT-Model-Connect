"""GPU smoke: exercise actual native SAM inference on the redistributable vendor image."""
import base64
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

workspace = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(workspace / 'models/sam-python-deps'))
from PIL import Image  # noqa: E402 - Local image dependency path is configured first.
runtime = workspace / 'runtime-vision'
image = workspace / 'showcase/vision-native/test-image.ppm'
if not image.is_file():
    raise RuntimeError('Run prepare-vision-fixture.ps1 first')
process = subprocess.Popen([str(runtime / 'trtmc_vision_bridge.exe'), '--bundle',
    str(workspace / 'models/sam-vit-base-rtx.bundle'), '--runtime-root', str(runtime),
    '--runtime-cache', str(workspace / 'models/sam-vit-base.rtx.cache')],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, encoding='utf-8', errors='replace', cwd=runtime)
events = queue.Queue()
stderr = []
def reader():
    for line in process.stdout:
        try:
            events.put(json.loads(line))
        except json.JSONDecodeError:
            events.put({'type': 'invalid_protocol', 'line': line})
    events.put({'type': 'process_exit'})
def error_reader():
    for line in process.stderr:
        stderr.append(line)
threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=error_reader, daemon=True).start()
receipt = {'model': 'facebook/sam-vit-base', 'backend': 'trt_rtx', 'complete': False, 'requests': []}
def wait_for(kind, seconds=180):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        event = events.get(timeout=max(0.1, deadline - time.monotonic()))
        if event['type'] == kind:
            return event
        if event['type'] in ('error', 'process_exit', 'invalid_protocol'):
            raise RuntimeError(json.dumps(event, ensure_ascii=False))
    raise TimeoutError(kind)
def send(value):
    process.stdin.write(json.dumps(value) + '\n')
    process.stdin.flush()
try:
    ready = wait_for('ready', 240)
    assert ready['family'] == 'sam' and ready['backend'] == 'trt_rtx' and ready['protocolVersion'] == 1
    receipt['ready'] = ready
    masks = []
    for request_id, x, y in [('car', 430, 225), ('sky', 120, 55)]:
        send({'type': 'segment', 'id': request_id, 'imagePath': str(image), 'points': [{'x': x, 'y': y, 'label': 1}]})
        result = wait_for('result')
        assert result['id'] == request_id and result['width'] == 640 and result['height'] == 382
        assert result['family'] == 'sam' and result['elapsedMs'] > 0
        mask = base64.b64decode(result.pop('maskBase64'), validate=True)
        assert len(mask) == 640 * 382 and set(mask) <= {0, 255}
        assert 0 < result['foregroundPixels'] < len(mask)
        assert mask[y * 640 + x] == 255, 'Foreground point must be present in selected object'
        assert result['score'] == max(result['scores'])
        masks.append(mask)
        mask_image = Image.frombytes('L', (640, 382), mask)
        mask_image.save(workspace / f'logs/vision-{request_id}-mask.png')
        original = Image.open(image).convert('RGBA')
        cutout = original.copy()
        cutout.putalpha(mask_image)
        cutout.save(workspace / f'logs/vision-{request_id}-cutout.png')
        overlay = Image.new('RGBA', original.size, (139, 213, 83, 0))
        overlay.putalpha(mask_image.point(lambda value: 90 if value else 0))
        Image.alpha_composite(original, overlay).save(workspace / f'logs/vision-{request_id}-overlay.png')
        receipt['requests'].append(result)
    assert masks[0] != masks[1], 'Moving the prompt between car and sky must change the output'
    send({'type': 'segment', 'id': 'invalid', 'imagePath': str(image), 'points': [{'x': 640, 'y': 10, 'label': 1}]})
    invalid = wait_for('error')
    assert invalid['id'] == 'invalid' and invalid['fatal'] is False
    send({'type': 'ping', 'id': 'alive'})
    assert wait_for('pong')['id'] == 'alive'
    send({'type': 'stop'})
    wait_for('stopped')
    assert process.wait(timeout=15) == 0
    receipt['complete'] = True
finally:
    if process.poll() is None:
        process.kill()
        process.wait(timeout=15)
    (workspace / 'logs/vision-native-smoke.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    (workspace / 'logs/vision-native-stderr.log').write_text(''.join(stderr), encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False), flush=True)
