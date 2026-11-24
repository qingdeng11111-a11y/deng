const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const C = require('../core.js');
const Z = require('../zip.js');
const P = require('../package.js');
const config = {delimiter: ',', timeColumn: 0, valueColumn: 1, timeUnit: 's', fromUnit: 'mV', toUnit: 'V', expectedInterval: null, minimum: null, maximum: null};
const run = (text, changes = {}) => C.analyze(C.parseCSV(text, changes.delimiter || ','), {...config, ...changes});
test('quoted comma, escaped quote, BOM, multiline and CRLF preserve values', () => {
  const d = C.parseCSV('\uFEFFt,v,n\r\n0,1,"x,y"\r\n1,2,"a""b\r\nc"\r\n');
  assert.deepEqual(d.rows, [['0','1','x,y'], ['1','2','a"b\r\nc']]);
});
test('empty quoted field and trailing delimiter are preserved', () => {
  assert.deepEqual(C.parseCSV('t,v\n0,""\n1,').rows, [['0',''], ['1','']]);
});
test('blank physical record is not silently deleted', () => {
  const r = run('t,v\n0,1\n\n1,2\n');
  assert.equal(r.summary.records, 3); assert.equal(r.issues[0].code, 'COLUMN_COUNT');
});
test('invalid quote syntax fails explicitly', () => {
  for (const text of ['t,v\n0,"x', 't,v\n0,"x"z', 't,v\n0,x"']) assert.throws(() => C.parseCSV(text));
});
test('invalid or duplicate headers and header-only files are rejected', () => {
  for (const text of ['', 't,t\n1,2', 't, \n1,2', 't,v\n', 'only\n1']) assert.throws(() => C.parseCSV(text));
});
test('semicolon and tab are explicit dialects', () => {
  assert.equal(run('t;v\n0;1000', {delimiter:';'}).normalized[0].value, 1);
  assert.equal(run('t\tv\n0\t2000', {delimiter:'\t'}).normalized[0].value, 2);
});
test('strict finite numeric grammar rejects coercion surprises', () => {
  for (const s of ['', ' ', '0x10', 'Infinity', 'NaN', '1e999', '=1+1', '1,2']) assert.equal(C.number(s), null);
  assert.equal(C.number(' -1.2e3 '), -1200); assert.equal(C.number('.5'), .5);
});
test('UTF-8 decoding fails instead of replacing invalid bytes', () => {
  assert.throws(() => C.decode(new Uint8Array([0xff,0xfe])));
  assert.throws(() => C.decode(new Uint8Array(C.MAX_BYTES + 1)));
});
test('unit conversion supports scale and absolute temperature offsets', () => {
  assert.equal(C.convert(1000, 'mV', 'V'), 1);
  assert.equal(C.convert(50, '%', '1'), .5);
  assert.ok(Math.abs(C.convert(0, '°C', 'K') - 273.15) < 1e-10);
  assert.ok(Math.abs(C.convert(32, '°F', '°C')) < 1e-10);
  assert.throws(() => C.convert(1, 'V', 'A'));
});
test('invalid config, inherited properties and reversed bounds are rejected', () => {
  for (const c of [{timeColumn:1}, {timeUnit:'toString'}, {fromUnit:'__proto__'}, {toUnit:'A'}, {expectedInterval:0}, {expectedInterval:-1}, {minimum:5,maximum:4}, {minimum:'bad'}]) assert.throws(() => run('t,v\n0,1', c));
});
test('known demo has exact issue counts and no dropped records', () => {
  const text = fs.readFileSync(path.join(__dirname,'../examples/demo-sensor.csv'),'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/demo-config.json')));
  const r = run(text, cfg);
  assert.deepEqual(r.summary, {records:8, errors:2, warnings:4, affectedRecords:5, numericPairs:6});
  assert.equal(r.normalized[5].value, 8.2); assert.equal(r.normalized[2].value, null);
  assert.deepEqual(r.issues.map(x => x.code), ['MISSING','DUPLICATE_TIME','TIME_BACKWARDS','OUT_OF_RANGE','TIME_GAP','NOT_NUMBER']);
});
test('invalid time breaks interval adjacency but duplicate detection spans the file', () => {
  const r = run('t,v\n0,1\nbad,2\n10,3\n0,4', {expectedInterval:1});
  assert.equal(r.issues.filter(x=>x.code==='TIME_GAP').length, 0);
  assert.equal(r.issues.filter(x=>x.code==='DUPLICATE_TIME').length, 1);
});
test('interval tolerance, bounds and zero values behave as documented', () => {
  assert.equal(run('t,v\n0,0\n1.04,1000',{expectedInterval:1,minimum:0,maximum:1}).issues.length,0);
  assert.equal(run('t,v\n0,0\n1.1,1000',{expectedInterval:1}).issues[0].code,'IRREGULAR_INTERVAL');
});
test('conversion overflow is an error and remains an empty normalized value', () => {
  const r=run('t,v\n1e308,1e308',{timeUnit:'min',fromUnit:'MPa',toUnit:'Pa'});
  assert.equal(r.summary.errors,2); assert.equal(r.normalized[0].value,null);
});
test('HTML escapes filenames and headers; normalized output contains no raw formulas', () => {
  const r=run('t,<img src=x onerror=alert(1)>\n0,=1+2');
  const html=C.reportHTML(r,'<script>alert(1)</script>','hash');
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!C.normalizedCSV(r).includes('=1+2'));
});
test('generated engine snapshot reproduces the same analysis', () => {
  const snapshot=eval(C.source);
  assert.deepEqual(snapshot.analyze(snapshot.parseCSV('t,v\n0,1'),config),run('t,v\n0,1'));
});
test('CSV limits fail rather than silently truncating', () => {
  assert.throws(()=>C.parseCSV('t,v\n'+'0,1\n'.repeat(C.MAX_ROWS+1)));
  assert.throws(()=>C.parseCSV(Array.from({length:201},(_,i)=>'h'+i).join(',')+'\n0,1'));
});
test('ZIP known CRC and headers are correct, traversal paths rejected', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const zip=Z.zip({'hello.txt':'你好'}), view=new DataView(zip.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50); assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
  assert.throws(()=>Z.zip({'../bad':'x'}));
});
test('portable package verifies in a different working directory and detects tampering', async () => {
  const bytes=Buffer.from('t,v\r\n0,1000\r\n1,2000\r\n');
  const hash=async b=>createHash('sha256').update(b).digest('hex');
  const files=await P.buildPackage(C,bytes,'中文.csv',run(bytes.toString()),hash);
  assert.deepEqual(files['original.csv'],bytes);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labcsv-test-'));
  try {
    for(const [name,content] of Object.entries(files)) fs.writeFileSync(path.join(dir,name),content);
    const output=execFileSync(process.execPath,[path.join(dir,'verify.cjs')],{cwd:os.tmpdir(),encoding:'utf8'});
    assert.match(output,/VERIFIED/);
    fs.appendFileSync(path.join(dir,'original.csv'),'2,3\n');
    const fail=spawnSync(process.execPath,[path.join(dir,'verify.cjs')],{encoding:'utf8'});
    assert.notEqual(fail.status,0); assert.match(fail.stderr,/SHA-256 mismatch/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
