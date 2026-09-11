// Transport fixture only; never packaged or used for application inference.
const readline = require('node:readline');
const mode = process.argv[2];
if (mode === 'malformed') process.stdout.write('not-json\n');
else if (mode !== 'never-ready') console.log(JSON.stringify({type: 'ready'}));
readline.createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.type === 'stop') return process.exit(0);
  if (request.type === 'generate') {
    if (request.prompt === 'wait') return;
    if (request.prompt === 'error') console.log(JSON.stringify({id: request.id, type: 'error', message: 'context limit', fatal: false}));
    else console.log(JSON.stringify({id: request.id, type: 'result', text: request.prompt}));
  }
});
