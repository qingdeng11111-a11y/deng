/* LabCSV Check — MIT. Shared deterministic engine for browsers and Node.js. */
(function (root) {
  'use strict';
  function createLabCSV() {
    'use strict';
    const VERSION = '0.1.1';
    const MAX_BYTES = 5 * 1024 * 1024;
    const MAX_ROWS = 50000;
    const units = {
      '1': ['ratio', 1, 0], '%': ['ratio', 0.01, 0],
      V: ['voltage', 1, 0], mV: ['voltage', 0.001, 0],
      A: ['current', 1, 0], mA: ['current', 0.001, 0],
      Pa: ['pressure', 1, 0], kPa: ['pressure', 1000, 0], MPa: ['pressure', 1e6, 0],
      m: ['length', 1, 0], cm: ['length', 0.01, 0], mm: ['length', 0.001, 0],
      K: ['temperature', 1, 0], '°C': ['temperature', 1, 273.15],
      '°F': ['temperature', 5 / 9, 255.3722222222222]
    };
    const times = {s: 1, ms: 0.001, min: 60};
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    function underflows(value) {
      const s = String(value).trim();
      return Number(s) === 0 && /[1-9]/.test(s.split(/e/i)[0]);
    }
    function number(value) {
      const s = String(value).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return null;
      const n = Number(s);
      return Number.isFinite(n) && !underflows(s) ? n : null;
    }
    function decode(bytes) {
      if (bytes.byteLength > MAX_BYTES) throw new Error('文件超过 5 MiB，请先拆分。');
      try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
      catch { throw new Error('文件不是有效 UTF-8。请先另存为 CSV UTF-8；不自动猜测编码。'); }
    }
    function parseCSV(text, delimiter = ',') {
      if (![',', ';', '\t'].includes(delimiter)) throw new Error('不支持的分隔符。');
      text = text.replace(/^\uFEFF/, '');
      if (!text.length) throw new Error('CSV 是空文件。');
      const rows = [];
      let row = [], value = '', state = 'start';
      function cell() {
        row.push(value); value = ''; state = 'start';
        if (row.length > 200) throw new Error('最多支持 200 列。');
      }
      function record() {
        cell(); rows.push(row); row = [];
        if (rows.length > MAX_ROWS + 1) throw new Error('最多支持 50,000 条数据记录。');
      }
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (state === 'quoted') {
          if (c === '"') {
            if (text[i + 1] === '"') { value += '"'; i++; }
            else state = 'closed';
          } else value += c;
        } else if (c === delimiter) cell();
        else if (c === '\r' || c === '\n') {
          record();
          if (c === '\r' && text[i + 1] === '\n') i++;
        } else if (c === '"' && state === 'start') state = 'quoted';
        else if (state === 'closed' || c === '"') throw new Error(`CSV 引号格式错误，字符位置 ${i + 1}。`);
        else { value += c; state = 'plain'; }
      }
      if (state === 'quoted') throw new Error('CSV 引号未闭合。');
      if (state !== 'start' || row.length || value.length) record();
      const headers = rows.shift().map(x => x.trim());
      if (headers.length < 2) throw new Error('至少需要两列；请检查分隔符。');
      if (headers.some(x => !x)) throw new Error('表头不能留空。');
      if (new Set(headers).size !== headers.length) throw new Error('表头名称重复（已忽略首尾空格）。');
      if (!rows.length) throw new Error('CSV 只有表头，没有数据。');
      return {headers, rows};
    }
    function optionalNumber(v, name) {
      if (v === '' || v === undefined || v === null) return null;
      const n = number(v);
      if (n === null) throw new Error(`${name}必须是有限数字。`);
      return n;
    }
    function validateConfig(data, config) {
      const c = {...config};
      if (!Number.isInteger(c.timeColumn) || !Number.isInteger(c.valueColumn) ||
          c.timeColumn < 0 || c.valueColumn < 0 || c.timeColumn >= data.headers.length ||
          c.valueColumn >= data.headers.length || c.timeColumn === c.valueColumn)
        throw new Error('请选择两个不同的有效列。');
      if (!own(times, c.timeUnit) || !own(units, c.fromUnit) || !own(units, c.toUnit))
        throw new Error('不支持的单位。');
      if (units[c.fromUnit][0] !== units[c.toUnit][0]) throw new Error('测量值的原单位和目标单位不属于同一物理量。');
      c.expectedInterval = optionalNumber(c.expectedInterval, '采样间隔');
      c.minimum = optionalNumber(c.minimum, '下限'); c.maximum = optionalNumber(c.maximum, '上限');
      if (c.expectedInterval !== null && c.expectedInterval <= 0) throw new Error('采样间隔必须大于 0 秒。');
      if (c.minimum !== null && c.maximum !== null && c.minimum > c.maximum) throw new Error('下限不能大于上限。');
      if (![',', ';', '\t'].includes(c.delimiter)) throw new Error('不支持的分隔符。');
      return c;
    }
    function convert(n, from, to) {
      if (!own(units, from) || !own(units, to) || units[from][0] !== units[to][0]) throw new Error('单位不兼容。');
      if (from === to) return n;
      const a = units[from], b = units[to];
      if (a[2] === 0 && b[2] === 0) return n * (a[1] / b[1]);
      return (n * a[1] + a[2] - b[2]) / b[1];
    }
    function analyze(data, config) {
      const c = validateConfig(data, config);
      const issues = [], normalized = [], seen = new Map();
      let previous = null, previousRecord = null;
      const add = (record, severity, code, message, column = null) => issues.push({record, severity, code, message, column});
      for (let i = 0; i < data.rows.length; i++) {
        const row = data.rows[i], record = i + 1, start = issues.length;
        let t = null, v = null;
        if (row.length !== data.headers.length) {
          add(record, 'error', 'COLUMN_COUNT', `应有 ${data.headers.length} 列，实际 ${row.length} 列；本记录不换算。`);
        } else {
          for (const [col, label] of [[c.timeColumn, '时间'], [c.valueColumn, '测量值']]) {
            const raw = row[col], n = number(raw);
            if (!raw.trim()) add(record, 'error', 'MISSING', `${label}为空。`, col);
            else if (n === null) add(record, 'error', underflows(raw) ? 'UNDERFLOW' : 'NOT_NUMBER', `${label}不是可表示的有限十进制数（可能下溢为零）。`, col);
            else {
              const out = col === c.timeColumn ? n * times[c.timeUnit] : convert(n, c.fromUnit, c.toUnit);
              if (!Number.isFinite(out)) add(record, 'error', 'OVERFLOW', `${label}换算后溢出。`, col);
              else if (out === 0 && n !== 0 && (col === c.timeColumn || (units[c.fromUnit][2] === 0 && units[c.toUnit][2] === 0)))
                add(record, 'error', 'UNDERFLOW', `${label}换算后下溢为零；本值不输出。`, col);
              else if (col === c.timeColumn) t = out;
              else v = out;
            }
          }
          if (v !== null && ((c.minimum !== null && v < c.minimum) || (c.maximum !== null && v > c.maximum)))
            add(record, 'warning', 'OUT_OF_RANGE', `测量值 ${v} ${c.toUnit} 超出用户设定范围。`, c.valueColumn);
        }
        if (t !== null) {
          if (seen.has(t)) add(record, 'warning', 'DUPLICATE_TIME', `时间与第 ${seen.get(t)} 条数据记录相同。`, c.timeColumn);
          else seen.set(t, record);
          if (previous !== null) {
            const delta = t - previous;
            const roundoff = 2 * Number.EPSILON * Math.max(Math.abs(t), Math.abs(previous));
            if (c.expectedInterval !== null && roundoff >= c.expectedInterval * 0.05)
              add(record, 'warning', 'TIME_PRECISION', '时间数值过大，相对于期望间隔的浮点精度不足；请从仪器原始数据生成相对时间。', c.timeColumn);
            if (delta < 0) add(record, 'warning', 'TIME_BACKWARDS', `时间早于第 ${previousRecord} 条数据记录。`, c.timeColumn);
            if (delta > 0 && c.expectedInterval !== null) {
              const difference = Math.abs(delta - c.expectedInterval);
              const tolerance = c.expectedInterval * 0.05 + Math.min(roundoff, c.expectedInterval * 0.005);
              if (difference > tolerance) {
                const gap = delta > c.expectedInterval * 1.5;
                add(record, 'warning', gap ? 'TIME_GAP' : 'IRREGULAR_INTERVAL',
                  `与前一条相邻有效记录的间隔为 ${delta} 秒，期望 ${c.expectedInterval} 秒（容差 5%）。${gap ? '可能缺测，请复核。' : ''}`, c.timeColumn);
              }
            }
          }
          previous = t; previousRecord = record;
        } else { previous = null; previousRecord = null; }
        normalized.push({record, time_s: t, value: v, unit: c.toUnit, codes: issues.slice(start).map(x => x.code)});
      }
      const errors = issues.filter(x => x.severity === 'error').length;
      const warnings = issues.length - errors;
      return {version: VERSION, config: c, headers: data.headers, summary: {
        records: data.rows.length, errors, warnings,
        affectedRecords: new Set(issues.map(x => x.record)).size,
        numericPairs: normalized.filter(x => x.time_s !== null && x.value !== null).length
      }, issues, normalized};
    }
    const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function normalizedCSV(result) {
      const lines = ['record,time_s,value,unit,issue_codes'];
      for (const r of result.normalized) lines.push([r.record, r.time_s ?? '', r.value ?? '', r.unit, r.codes.join('|')].join(','));
      return '\uFEFF' + lines.join('\r\n') + '\r\n';
    }
    function reportHTML(result, name, hash) {
      const e = escapeHTML;
      return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
        '<title>LabCSV 检查报告</title><style>body{font:16px/1.7 system-ui;max-width:1050px;margin:40px auto;padding:20px;color:#15332f}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}h1{color:#067565}</style>' +
        `<h1>LabCSV 检查报告</h1><p>文件：${e(name)} · 引擎 ${VERSION}</p><p>原始 SHA-256：<code>${e(hash)}</code></p>` +
        `<p>${result.summary.records} 条记录；${result.summary.errors} 个错误；${result.summary.warnings} 个待复核提示。</p>` +
        '<p>数据记录号不含表头；多行引号字段可能跨物理行。未删除、插值或排序。仅检查选定两列；零问题不代表实验正确。空的换算值表示无法换算，原值保存在 original.csv。</p>' +
        `<h2>配置</h2><pre>${e(JSON.stringify(result.config, null, 2))}</pre><h2>全部问题</h2>` +
        '<table><thead><tr><th>记录</th><th>级别</th><th>代码</th><th>说明</th></tr></thead><tbody>' +
        result.issues.map(x => `<tr><td>${x.record}</td><td>${e(x.severity)}</td><td>${e(x.code)}</td><td>${e(x.message)}</td></tr>`).join('') +
        '</tbody></table></html>';
    }
    return {VERSION, MAX_BYTES, MAX_ROWS, units, times, number, decode, parseCSV, analyze, convert, normalizedCSV, reportHTML, escapeHTML};
  }
  const api = createLabCSV();
  api.source = '(' + createLabCSV.toString() + ')()';
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabCSV = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
