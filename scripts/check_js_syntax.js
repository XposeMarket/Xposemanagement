const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'pages', 'jobs.js');
try {
  let code = fs.readFileSync(file, 'utf8');
  // Strip ES module import/export lines to allow syntax-only check in Node
  code = code.split('\n').filter(line => {
    const t = line.trim();
    if (t.startsWith('import ')) return false;
    if (t.startsWith('export ')) return false;
    return true;
  }).join('\n');

  // Replace top-level `window.` references to avoid errors during parsing
  // (we're only checking syntax, not executing runtime behavior)
  // Not strictly necessary but keeps Function() from failing on top-level await etc.

  new Function(code);
  console.log('OK: No syntax errors (after stripping imports/exports)');
} catch (err) {
  console.error('SYNTAX ERROR:', err && err.message);
  if (err && err.stack) console.error(err.stack);
  process.exitCode = 2;
}

// Additional simple brace/paren/bracket balance checker
try {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const stack = [];
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const opening = Object.keys(pairs);
  const closing = Object.values(pairs);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (opening.includes(ch)) stack.push({ch, line: i+1, col: j+1});
      if (closing.includes(ch)) {
        const expected = stack.length ? pairs[stack[stack.length-1].ch] : null;
        if (expected === ch) stack.pop();
        else {
          console.error(`Balance error: unexpected closing '${ch}' at line ${i+1} col ${j+1}, expected '${expected || 'none'}'`);
          console.error('Context:', lines[Math.max(0,i-1)] || '', '\n', line, '\n', lines[i+1] || '');
          process.exit(3);
        }
      }
    }
  }
  if (stack.length) {
    const top = stack[stack.length-1];
    console.error(`Balance error: unclosed '${top.ch}' opened at line ${top.line} col ${top.col}`);
    console.error('First 3 unmatched stack entries:', stack.slice(-3));
    process.exit(4);
  }
  console.log('Braces/paren/bracket counts balanced');
} catch (e) {
  // ignore
}
