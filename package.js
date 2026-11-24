/* Portable evidence package builder, MIT. */
(function (root) {
  'use strict';
  async function buildPackage(core, bytes, filename, result, hashFn) {
    const encode = value => new TextEncoder().encode(value);
    const json = value => JSON.stringify(value, null, 2) + '\n';
    const hash = await hashFn(bytes);
    const verify = `'use strict';
// Generated snapshot of LabCSV Check ${core.VERSION}, MIT.
// Run from any directory: node /path/to/verify.cjs
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const core = ${core.source};
const read = name => fs.readFileSync(path.join(__dirname, name));
const manifest = JSON.parse(read('manifest.json'));
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Unsafe manifest path');
  const actual = createHash('sha256').update(read(name)).digest('hex');
  if (actual !== expected) throw new Error('SHA-256 mismatch: ' + name);
}
const config = JSON.parse(read('config.json'));
const result = core.analyze(core.parseCSV(core.decode(read('original.csv')), config.delimiter), config);
const saved = JSON.parse(read('report.json'));
if (JSON.stringify(result) !== JSON.stringify(saved.analysis)) throw new Error('Analysis mismatch');
if (core.normalizedCSV(result) !== read('normalized.csv').toString('utf8')) throw new Error('CSV mismatch');
console.log('VERIFIED: file hashes and deterministic analysis match.');
console.log(JSON.stringify(result.summary, null, 2));
// Exit 0 means reproducible, not issue-free or scientifically correct.
`;
    const files = {
      'original.csv': bytes,
      'normalized.csv': encode(core.normalizedCSV(result)),
      'config.json': encode(json(result.config)),
      'report.json': encode(json({schemaVersion: 1, originalFilename: filename, originalSha256: hash, analysis: result})),
      'report.html': encode(core.reportHTML(result, filename, hash)),
      'verify.cjs': encode(verify),
      'README.txt': encode('LabCSV Check ' + core.VERSION + '\n\n' +
        '1. 双击 report.html 阅读全部检查结果。\n' +
        '2. original.csv 是原始字节，未改写；即使原文件是 TSV，文件名也固定为 original.csv，实际分隔符见 config.json。\n' +
        '3. normalized.csv 只含选定两列；record 对应原始数据记录号（不含表头），不是物理行号。空换算值配有错误代码。\n' +
        '4. 使用 Node.js 22+，运行 node verify.cjs 核验文件哈希并重跑检查。无需 npm install。\n' +
        '5. 通过核验只说明包内结果一致，不证明实验正确；manifest 没有数字签名，不能抵抗整包伪造。\n' +
        '6. 分享前检查 original.csv 是否含隐私或电子表格公式。原始文件不会脱敏或过滤公式；请勿直接信任未知来源的 CSV。\n' +
        '7. 相同数值时间检查使用精确比较；间隔检查容差为 5%。无效时间记录会断开相邻间隔比较。\n' +
        '8. 仅检查用户选择的两列；不删除、插值、排序或修复原始记录。\n')
    };
    const hashes = {};
    for (const [name, content] of Object.entries(files)) hashes[name] = await hashFn(content);
    files['manifest.json'] = encode(json({schemaVersion: 1, algorithm: 'SHA-256', files: hashes}));
    return files;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {buildPackage};
  else root.LabPackage = {buildPackage};
})(globalThis);
