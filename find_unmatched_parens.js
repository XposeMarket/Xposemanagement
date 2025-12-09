const fs = require('fs');
const file = process.argv[2];
const s = fs.readFileSync(file,'utf8');
const lines = s.split(/\r?\n/);
let stack = [];
for (let i=0;i<lines.length;i++){
  const line = lines[i];
  for (let j=0;j<line.length;j++){
    const ch = line[j];
    if (ch==='(') stack.push({line:i+1,col:j+1,context:lines[i].trim().slice(0,120)});
    else if (ch===')'){
      if (stack.length===0) console.log('Extra ) at',i+1,j+1);
      else stack.pop();
    }
  }
}
if (stack.length===0) console.log('All parens matched'); else console.log('Unmatched ( count=',stack.length, stack.slice(-5));
