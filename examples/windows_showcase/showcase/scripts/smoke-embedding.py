"""Exercise the real native E5 bridge and compare against independent CPU vectors.

This test uses the GPU. Run only while holding the application's coordinated GPU
slot. Its guardian and all model descendants are owned by this invocation.
"""
import argparse
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
args = parser.parse_args()
workspace = args.workspace.resolve()
sys.stdout.reconfigure(encoding='utf-8')
sys.path[:0] = [str(workspace / 'models' / 'e5-python-deps'), str(workspace / 'python-deps')]
os.environ['HF_HUB_OFFLINE'] = '1'
from transformers import AutoTokenizer  # noqa: E402 - Configure offline loading and dependency paths first.

reference = json.loads((workspace / 'models' / 'e5-cpu-reference.json').read_text(encoding='utf-8'))
tokenizer = AutoTokenizer.from_pretrained(workspace / 'models' / 'e5-small', local_files_only=True)
boundary_texts = {}
for count in range(490, 515):
    candidate = ' '.join(['test'] * count)
    tokens = len(tokenizer('query: ' + candidate, verbose=False)['input_ids'])
    if tokens in (512, 513):
        boundary_texts[tokens] = candidate
assert set(boundary_texts) == {512, 513}, 'Unable to prepare exact token boundary fixtures'

evidence = workspace / 'showcase' / 'embedding-native'
report_path = evidence / 'validation.json'
events_path = evidence / 'validation.ndjson'
diagnostics_path = evidence / 'validation.stderr.log'
report = {'complete': False, 'model': reference['model'], 'revision': reference['revision'],
          'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'checks': []}
messages = queue.Queue()
process = None
started = time.perf_counter()


def check(condition, name):
    if not condition:
        raise AssertionError(name)
    report['checks'].append(name)


def receive(event_type, request_id=None, timeout=240):
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f'Timed out waiting for {event_type} {request_id}')
        message = messages.get(timeout=remaining)
        if isinstance(message, BaseException):
            raise message
        if message['type'] == 'error' and event_type != 'error':
            raise RuntimeError(f'Native bridge error: {message}')
        if message['type'] == event_type and (request_id is None or message.get('id') == request_id):
            return message


def send(value):
    process.stdin.write(json.dumps(value, ensure_ascii=False) + '\n')
    process.stdin.flush()


def cosine(left, right):
    return sum(a * b for a, b in zip(left, right)) / math.sqrt(
        sum(a * a for a in left) * sum(b * b for b in right))


try:
    with diagnostics_path.open('w', encoding='utf-8') as diagnostics, events_path.open('w', encoding='utf-8') as events:
        command = [str(workspace / 'runtime-host' / 'modelconnect_process_host.exe'),
                   '--parent-pid', str(os.getpid()), '--',
                   str(workspace / 'runtime-embedding' / 'trtmc_embedding_bridge.exe'),
                   '--bundle', str(workspace / 'models' / 'multilingual-e5-small-rtx.bundle'),
                   '--runtime-root', str(workspace / 'runtime-embedding'),
                   '--runtime-cache', str(workspace / 'models' / 'multilingual-e5-small.rtx.cache')]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=diagnostics, text=True, encoding='utf-8',
                                   cwd=workspace, creationflags=subprocess.CREATE_NO_WINDOW)
        report['guardianPid'] = process.pid

        def read_output():
            try:
                for line in process.stdout:
                    events.write(line)
                    events.flush()
                    messages.put(json.loads(line))
                messages.put(EOFError('Native bridge stdout closed'))
            except BaseException as error:
                messages.put(error)

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        ready = receive('ready')
        report['ready'] = ready
        check(ready['model'] == reference['model'] and ready['revision'] == reference['revision'], 'Pinned model identity')
        check(ready['backend'] == 'trt_rtx' and ready['family'] == 'bert' and ready['dimension'] == 384, 'Real BERT RTX embedding contract')
        check(ready['maxSequenceLength'] == 512 and ready['maxTexts'] == 24, 'Advertised limits')
        send({'id': 'cross-language', 'type': 'embed', 'texts': reference['texts'], 'roles': reference['roles']})
        result = receive('result', 'cross-language')
        check(result['texts'] == reference['texts'] and result['roles'] == reference['roles'] and
              result['modelInputs'] == reference['modelInputs'], 'Exact input and E5 prefix provenance')
        check(result['tokenCounts'] == reference['tokenCounts'], 'Native tokenizer agrees with HF on English and Chinese fixtures')
        check(len(result['vectors']) == 8 and all(len(row) == 384 for row in result['vectors']), 'Eight real 384-dimensional vectors')
        check(all(math.isfinite(value) for row in result['vectors'] for value in row), 'Finite vector components')
        check(all(abs(math.sqrt(sum(value * value for value in row)) - 1) < 0.001 for row in result['vectors']), 'Measured L2 norms within 0.001')
        agreements = [cosine(actual, expected) for actual, expected in zip(result['vectors'], reference['vectors'])]
        report['nativeVsCpuCosine'] = agreements
        check(min(agreements) >= 0.999, 'Every native vector meets repository CPU reference cosine threshold 0.999')
        scores = [[cosine(left, right) for right in result['vectors']] for left in result['vectors']]
        report['similarities'] = scores
        check(scores[0][1] > scores[0][2] and scores[0][1] > scores[0][3], 'Chinese query ranks relevant English meeting-audio passage above distractors')
        check(scores[4][5] > max(scores[4][1], scores[4][2], scores[4][3], scores[4][6]), 'English recipe query ranks Chinese pumpkin recipe first')
        check(cosine(result['vectors'][0], result['vectors'][7]) > 0.999999, 'Repeated input is consistent')
        report['embeddingTotalMs'] = result['totalMs']
        report['perTextMs'] = result['perTextMs']
        send({'id': 'limit-512', 'type': 'embed', 'texts': [boundary_texts[512]], 'roles': ['query']})
        boundary = receive('result', 'limit-512')
        check(boundary['tokenCounts'] == [512] and len(boundary['vectors'][0]) == 384, 'Exactly 512 tokens succeeds')
        invalid = [
            ('limit-513', {'texts': [boundary_texts[513]], 'roles': ['query']}, '513 tokens'),
            ('empty-texts', {'texts': []}, '1 to 24'),
            ('too-many', {'texts': ['a'] * 25}, '1 to 24'),
            ('blank', {'texts': [' \t\n']}, '1 to 8192'),
            ('role-length', {'texts': ['hello'], 'roles': []}, 'roles must match'),
            ('role-value', {'texts': ['hello'], 'roles': ['unknown']}, 'query or passage'),
            ('nul', {'texts': ['hello\0world']}, 'without NUL'),
        ]
        for request_id, value, message_fragment in invalid:
            send({'id': request_id, 'type': 'embed', **value})
            error = receive('error', request_id)
            check(error['fatal'] is False and message_fragment in error['message'], f'Reject invalid input: {request_id}')
        process.stdin.write('{broken-json\n')
        process.stdin.flush()
        malformed = receive('error')
        check(malformed['fatal'] is False, 'Malformed JSON is recoverable')
        send({'id': 'after-errors', 'type': 'ping'})
        receive('pong', 'after-errors')
        check(process.poll() is None, 'Bridge remains responsive after invalid requests')
        send({'id': 'default-role', 'type': 'embed', 'texts': ['This calculation uses a real model.']})
        default_role = receive('result', 'default-role')
        check(default_role['roles'] == ['passage'] and default_role['modelInputs'] == ['passage: This calculation uses a real model.'], 'Default passage role is explicit in provenance')
        send({'type': 'stop'})
        receive('stopped')
        check(process.wait(timeout=30) == 0, 'Graceful stop preserves native exit code zero')
        reader.join(timeout=5)
        check(not reader.is_alive(), 'Native output reader closed')
        report['complete'] = True
except BaseException as error:
    report['failure'] = repr(error)
    raise
finally:
    if process is not None:
        if process.poll() is None:
            process.kill()  # Kills only this owned guardian; its Job Object kills all its descendants.
        process.wait(timeout=30)
    report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    report['wallTimeMs'] = (time.perf_counter() - started) * 1000
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'report': str(report_path), 'complete': report['complete'],
                      'checks': len(report['checks']), 'minimumReferenceCosine': min(report.get('nativeVsCpuCosine', [0])),
                      'wallTimeMs': report['wallTimeMs'], 'failure': report.get('failure')}, ensure_ascii=False))
