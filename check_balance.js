const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node check_balance.js <file>'); process.exit(1); }
const s = fs.readFileSync(path,'utf8');
let counts = { '{':0, '}':0, '(':0, ')':0, '[':0, ']':0 };
for (const ch of s) { if (counts.hasOwnProperty(ch)) counts[ch]++; }
console.log('Counts:', counts);
// Find last positions
for (const k of ['{','}','(','),','[',']']){}
// Print last 200 chars for inspection
console.log('\n--- tail of file ---\n');
console.log(s.slice(-400));
