"""Linux process fixture: adjacent TERM/KILL calls do not ensure TERM handling."""
import json
import select
import subprocess
import tempfile
from pathlib import Path

WORKER = """
const fs = require('node:fs');
process.on('SIGTERM', () => {
  fs.writeFileSync(process.argv[1], 'handled');
  process.exit(0);
});
console.log('ready');
setInterval(() => {}, 10000);
"""

def run(immediate_kill):
    with tempfile.TemporaryDirectory(prefix='kunai-signal-proof-') as root:
        marker = Path(root) / 'term-handled'
        child = subprocess.Popen(['node', '-e', WORKER, str(marker)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            if not select.select([child.stdout], [], [], 5)[0]:
                raise RuntimeError('fixture failed to become ready')
            if child.stdout.readline().strip() != 'ready':
                raise RuntimeError('fixture did not install its handler')
            child.terminate()
            if immediate_kill:
                child.kill()
            child.wait(timeout=5)
            return {'term_handler_ran': marker.exists(), 'returncode': child.returncode}
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)

print(json.dumps({'term_only_control': run(False), 'adjacent_term_kill': [run(True) for _ in range(10)]}, indent=2))
