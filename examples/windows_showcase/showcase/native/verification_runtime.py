"""Process lifetime and whole-GPU telemetry for opt-in native verification."""
import os
from pathlib import Path
import subprocess
import threading
import time


def guarded_command(root: Path, arguments: list[str]) -> list[str]:
    host = root / 'runtime-host' / 'modelconnect_process_host.exe'
    if host.is_file():
        return [str(host), '--parent-pid', str(os.getpid()), '--', *arguments]
    return arguments


def query_gpu():
    raw = subprocess.check_output(['nvidia-smi', '--query-gpu=name,memory.used,memory.total,utilization.gpu',
        '--format=csv,noheader,nounits'], text=True, encoding='utf-8', timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW).strip().splitlines()[0]
    name, used, total, utilization = [value.strip() for value in raw.split(',')]
    return {'name': name, 'usedMiB': int(used), 'totalMiB': int(total), 'utilizationPercent': int(utilization)}


class GpuMonitor:
    def __init__(self):
        self.before = query_gpu()
        self.samples = []
        self.done = threading.Event()
        self.started = time.monotonic()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while not self.done.is_set():
            try:
                self.samples.append({'elapsedSeconds': time.monotonic() - self.started, **query_gpu()})
            except Exception:
                pass
            self.done.wait(1.0)

    def finish(self):
        self.done.set()
        self.thread.join(timeout=12)
        return {'beforeLoad': self.before, 'afterShutdown': query_gpu(),
            'peakSampledUsedMiB': max([self.before['usedMiB'], *[sample['usedMiB'] for sample in self.samples]]),
            'samples': self.samples,
            'scope': 'Whole-GPU telemetry sampled approximately every second; includes existing desktop/game background load. Not an exclusive model-memory measurement.'}
