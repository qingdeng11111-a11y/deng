'use strict';
(() => {
  const C = LabCSV, $ = id => document.getElementById(id);
  let data = null, bytes = null, filename = '', result = null, generation = 0;
  const demo = 'time_ms,voltage_mV,note\r\n0,1200,正常\r\n1000,1250,正常\r\n2000,,缺少测量值\r\n2000,1290,重复时间\r\n1500,1300,时间倒退\r\n5000,8200,缺测和超限\r\n6000,not-a-number,无效测量值\r\n7000,1400,"演示,引号内逗号"\r\n';
  const delimiter = () => $('delimiter').value === 'tab' ? '\t' : $('delimiter').value;
  const notice = (message, error = false) => { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; };
  function invalidate() {
    result = null; $('export').disabled = true;
    $('summary').replaceChildren(...['数据记录', '错误', '待复核', '涉及记录'].map(label => {
      const box = document.createElement('div'), strong = document.createElement('strong'), span = document.createElement('span');
      strong.textContent = '—'; span.textContent = label; box.append(strong, span); return box;
    }));
    $('issues').textContent = '规则或输入已更改，请重新检查。';
  }
  function table(headers, rows, parent) {
    const t = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
    function line(values, header = false) {
      const tr = document.createElement('tr');
      for (const v of values) { const cell = document.createElement(header ? 'th' : 'td'); cell.textContent = String(v); tr.append(cell); }
      return tr;
    }
    head.append(line(headers, true)); rows.forEach(r => body.append(line(r))); t.append(head, body); parent.replaceChildren(t);
  }
  function select(id, values, chosen) {
    $(id).replaceChildren(...values.map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }));
    $(id).value = chosen;
  }
  function parse() {
    invalidate(); data = null; $('settings').disabled = true;
    try {
      data = C.parseCSV(C.decode(bytes), delimiter());
      const columns = data.headers.map((h, i) => [String(i), `${i + 1}. ${h}`]);
      select('timeColumn', columns, '0'); select('valueColumn', columns, '1');
      table(['记录', ...data.headers], data.rows.slice(0, 8).map((r, i) => [i + 1, ...r]), $('preview'));
      $('previewCount').textContent = `${data.rows.length} 条记录 · 预览前 ${Math.min(8, data.rows.length)} 条`;
      $('settings').disabled = false;
      notice('数据已载入。请确认时间列、测量值列和单位，再开始检查。');
    } catch (err) {
      $('preview').textContent = '无法解析此文件。'; $('previewCount').textContent = '导入失败'; notice(err.message, true);
    }
  }
  $('demo').addEventListener('click', () => {
    generation++; bytes = new TextEncoder().encode(demo); filename = 'demo-sensor.csv'; $('file').value = '';
    $('filename').textContent = filename; $('delimiter').value = ','; parse();
    $('timeUnit').value = 'ms'; $('fromUnit').value = 'mV'; updateTargets('V');
    $('interval').value = '1'; $('minimum').value = '0'; $('maximum').value = '5';
    notice('示例已载入：8 条记录，预期 2 个错误、4 个待复核提示。点击「开始检查」。');
  });
  $('file').addEventListener('change', async () => {
    const token = ++generation, file = $('file').files[0];
    invalidate(); data = null; bytes = null; $('settings').disabled = true;
    $('preview').textContent = '等待载入'; $('previewCount').textContent = '';
    if (!file) { $('filename').textContent = '还没有选择文件'; return; }
    filename = file.name; $('filename').textContent = filename;
    try {
      if (file.size > C.MAX_BYTES) throw new Error('文件超过 5 MiB，请先拆分。');
      const buffer = await file.arrayBuffer();
      if (generation !== token) return;
      bytes = new Uint8Array(buffer);
      $('delimiter').value = /\.tsv$/i.test(filename) ? 'tab' : ',';
      $('timeUnit').value = 's'; $('fromUnit').value = '1'; updateTargets('1');
      $('interval').value = ''; $('minimum').value = ''; $('maximum').value = '';
      parse();
    } catch (err) { if (generation === token) notice(err.message, true); }
  });
  $('delimiter').addEventListener('change', () => { generation++; if (bytes) parse(); });
  function updateTargets(preferred) {
    const from = $('fromUnit').value;
    const choices = Object.keys(C.units).filter(u => C.units[u][0] === C.units[from][0]).map(u => [u, u === '1' ? '无量纲 1' : u]);
    select('toUnit', choices, choices.some(([u]) => u === preferred) ? preferred : from);
  }
  select('fromUnit', Object.keys(C.units).map(u => [u, u === '1' ? '无量纲 1' : u]), '1'); updateTargets('1');
  $('fromUnit').addEventListener('change', () => updateTargets($('toUnit').value));
  $('settings').addEventListener('input', () => { generation++; invalidate(); notice('规则已更改，旧结果已失效。请重新检查。'); });
  $('run').addEventListener('click', () => {
    if (!data) return;
    invalidate();
    try {
      result = C.analyze(data, {delimiter: delimiter(), timeColumn: Number($('timeColumn').value), valueColumn: Number($('valueColumn').value),
        timeUnit: $('timeUnit').value, fromUnit: $('fromUnit').value, toUnit: $('toUnit').value,
        expectedInterval: $('interval').value, minimum: $('minimum').value, maximum: $('maximum').value});
      const s = result.summary;
      $('summary').replaceChildren(...[[s.records, '数据记录'], [s.errors, '错误'], [s.warnings, '待复核'], [s.affectedRecords, '涉及记录']].map(([n, title]) => {
        const box = document.createElement('div'), strong = document.createElement('strong'), span = document.createElement('span');
        strong.textContent = n; span.textContent = title; box.append(strong, span); return box;
      }));
      if (result.issues.length) table(['记录', '级别', '问题', '说明'], result.issues.slice(0, 200).map(x => [x.record, x.severity === 'error' ? '错误' : '待复核', x.code, x.message]), $('issues'));
      else $('issues').textContent = '在当前配置覆盖的规则内，未发现问题。';
      $('export').disabled = false;
      notice(`检查完成：${s.errors} 个错误、${s.warnings} 个待复核提示。可以导出交付包。`);
    } catch (err) { result = null; notice(err.message, true); }
  });
  async function hash(input) {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持本地 SHA-256。请使用新版 Edge/Chrome 打开本地文件或 localhost。');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), b => b.toString(16).padStart(2, '0')).join('');
  }
  $('export').addEventListener('click', async () => {
    if (!result) return;
    const token = generation, snapshot = result;
    $('export').disabled = true;
    try {
      const files = await LabPackage.buildPackage(C, bytes, filename, snapshot, hash);
      if (generation !== token || result !== snapshot) return;
      const url = URL.createObjectURL(new Blob([LabZip.zip(files)], {type: 'application/zip'}));
      const a = document.createElement('a'); a.href = url; a.download = 'labcsv-delivery.zip'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notice('交付包已生成。解压后打开 report.html；分享前请检查原始文件内容。');
    } catch (err) { notice(err.message, true); }
    finally { $('export').disabled = !result; }
  });
})();
