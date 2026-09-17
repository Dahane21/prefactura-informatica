(() => {
  'use strict';

  const LS_NORMAL = 'pref_informatica_tarifas_normal_v3_exact';
  const LS_MINI = 'pref_informatica_tarifas_mini_v2_exact';
  const LS_HISTORY = 'pref_informatica_history_v1';

  const OUTPUT_HEADERS = [
    'ESTADO','COD','OFICINA','GR TRADEL','GR BBVA','PESO KG.','ORIGEN','DESTINO','MINI','TIPO','SERVICIO','CONTENIDO',
    'FECHA DE SOLICITUD','FECHA DE ENTREGA','AMBITO','COLUM.','CONDICION','TERRIT.','TAR\nx Kg','1er kilo','PESO REST.',
    'FLETE\nPrecio x kilo','COND. FALSO FLETE','FLETE \nTOTAL','IGV 18%','TOTAL\nS/.'
  ];

  const state = {
    masters: { normal: [], mini: [] },
    activeMaster: 'normal',
    sourceHeaders: [],
    sourceRows: [],
    processed: [],
    review: [],
    period: '',
    currentFile: '',
    editSourceIndex: null,
    editMasterIndex: null,
    masterAdding: false,
    history: [],
    reviewFilter: 'ALL'
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function norm(v) {
    return String(v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().toUpperCase();
  }

  function asNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = String(v ?? '').trim().replace(/\s/g, '').replace(/S\/?/ig, '').replace(/,/g, '.');
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function money(v) {
    return `S/ ${Number(v || 0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  }

  function excelDateToJS(v) {
    if (v instanceof Date && !isNaN(v)) return v;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const utc = Math.round((v - 25569) * 86400 * 1000);
      return new Date(utc);
    }
    const s = String(v ?? '').trim();
    if (!s || norm(s) === 'FF') return null;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let y = Number(m[3]); if (y < 100) y += 2000;
      const d = new Date(y, Number(m[2])-1, Number(m[1]));
      return isNaN(d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function dateText(v) {
    if (norm(v) === 'FF') return 'FF';
    const d = excelDateToJS(v);
    return d ? d.toLocaleDateString('es-PE') : String(v ?? '');
  }

  function yearFromRows(rows) {
    for (const r of rows) {
      const d = excelDateToJS(r.requestDate);
      if (d) return d.getFullYear();
    }
    return new Date().getFullYear();
  }

  function cloneRows(rows) { return JSON.parse(JSON.stringify(rows)); }

  function loadMasters() {
    try {
      state.masters.normal = JSON.parse(localStorage.getItem(LS_NORMAL)) || cloneRows(window.DEFAULT_MASTERS.tarifas);
      state.masters.mini = JSON.parse(localStorage.getItem(LS_MINI)) || cloneRows(window.DEFAULT_MASTERS.mini);
    } catch {
      state.masters.normal = cloneRows(window.DEFAULT_MASTERS.tarifas);
      state.masters.mini = cloneRows(window.DEFAULT_MASTERS.mini);
    }
  }

  function saveMaster(kind) {
    localStorage.setItem(kind === 'normal' ? LS_NORMAL : LS_MINI, JSON.stringify(state.masters[kind]));
  }

  function loadHistory() {
    try { state.history = JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { state.history = []; }
  }

  function saveHistory() {
    localStorage.setItem(LS_HISTORY, JSON.stringify(state.history.slice(0,50)));
  }

  function headerMap(headers) {
    const map = new Map();
    headers.forEach((h,i) => map.set(norm(h), i));
    return map;
  }

  function idx(map, aliases) {
    for (const a of aliases) {
      const k = norm(a);
      if (map.has(k)) return map.get(k);
    }
    return -1;
  }

  function masterSchema(kind) {
    const rows = state.masters[kind];
    const h = rows[0] || [];
    const m = headerMap(h);
    return {
      headers: h,
      cod: idx(m,['COD','CODE']),
      oficina: idx(m,['OFICINA']),
      tipoReg: idx(m,['TIPO REG']),
      reg1: idx(m,['REGULAR 1KG','REGULAR 1 KG']),
      tipoExp: idx(m,['TIPO EXP']),
      exp1: idx(m,['EXPRESS 1KG','EXPRESS 1 KG']),
      regAdd: idx(m,['REGULAR KG. ADICIONAL','REGULAR KG ADICIONAL']),
      expAdd: idx(m,['EXPRESS KG. ADICIONAL','EXPRESS KG ADICIONAL']),
      nombre: idx(m,['NOMBRE']),
      territorio: idx(m,['TERRITORIO'])
    };
  }

  function findMasterRows(kind, code) {
    const schema = masterSchema(kind);
    if (schema.cod < 0) return [];
    const key = norm(code).replace(/^0+/, '');
    return state.masters[kind].slice(1).map((r,i)=>({row:r,index:i+1})).filter(x => norm(x.row[schema.cod]).replace(/^0+/,'') === key);
  }

  function getMasterRecord(kind, code, type) {
    const schema = masterSchema(kind);
    const found = findMasterRows(kind, code);
    if (!found.length) return { error:`El código ${code || '(vacío)'} no existe en ${kind === 'mini' ? 'MINI' : 'TARIFAS'}.` };
    const r = found[0].row;
    const t = norm(type);
    const firstKg = asNumber(r[t === 'EXP' ? schema.exp1 : schema.reg1]);
    const addKg = asNumber(r[t === 'EXP' ? schema.expAdd : schema.regAdd]);
    let terr;
    if (kind === 'mini') {
      // La prefactura actual trata Mini Almacén como terrestre nacional.
      terr = 'TE';
    } else {
      terr = norm(r[t === 'EXP' ? schema.tipoExp : schema.tipoReg]);
    }
    const destination = String(r[schema.nombre] ?? '').trim();
    const office = String(r[schema.oficina] ?? '').trim();
    const errors = [];
    if (!Number.isFinite(firstKg)) errors.push('Falta la tarifa del primer kilo.');
    if (!Number.isFinite(addKg)) errors.push('Falta la tarifa por kilo adicional.');
    if (!['LC','AE','TE'].includes(terr)) errors.push(`Territorio no válido en el tarifario (${terr || 'vacío'}).`);
    if (!destination) errors.push('Falta NOMBRE/ciudad en el tarifario.');
    if (errors.length) return { error: errors.join(' ') };

    // Detecta duplicados conflictivos sin cambiar la regla actual de tomar la primera coincidencia.
    let duplicateWarning = '';
    if (found.length > 1) {
      const sig = `${firstKg}|${addKg}|${terr}|${norm(destination)}`;
      for (const alt of found.slice(1)) {
        const ar = alt.row;
        const af = asNumber(ar[t === 'EXP' ? schema.exp1 : schema.reg1]);
        const aa = asNumber(ar[t === 'EXP' ? schema.expAdd : schema.regAdd]);
        const at = kind === 'mini' ? 'TE' : norm(ar[t === 'EXP' ? schema.tipoExp : schema.tipoReg]);
        const ad = norm(ar[schema.nombre]);
        if (`${af}|${aa}|${at}|${ad}` !== sig) {
          duplicateWarning = `Código duplicado con datos distintos en ${kind === 'mini' ? 'MINI' : 'TARIFAS'}.`;
          break;
        }
      }
    }
    return { firstKg, addKg, terr, destination, office, duplicateWarning };
  }

  function parseSource(rows) {
    if (!rows || rows.length < 2) throw new Error('El archivo no contiene filas suficientes.');
    let headerIndex = rows.findIndex(r => r.some(v => norm(v)==='PRE') && r.some(v => ['CODE','COD'].includes(norm(v))) && r.some(v => norm(v).includes('PESO')));
    if (headerIndex < 0) headerIndex = 0;
    const headers = rows[headerIndex].map(v => String(v ?? '').trim());
    const hm = headerMap(headers);
    const col = {
      pre: idx(hm,['PRE']),
      code: idx(hm,['CODE','COD']),
      office: idx(hm,['OFICINA']),
      grTradel: idx(hm,['GR TRADEL']),
      grBBVA: idx(hm,['GR BBVA']),
      weight: idx(hm,['PESO KG.','PESO KG','PESO']),
      mini: idx(hm,['MINI']),
      type: idx(hm,['TIPO']),
      service: idx(hm,['SERVICIO']),
      content: idx(hm,['CONTENIDO']),
      status: idx(hm,['ESTADO']),
      requestDate: idx(hm,['FECHA DE GUIA','FECHA DE GUÍA']),
      deliveryDate: idx(hm,['FECHA DE ENTREGA2','FECHA DE ENTREGA']),
      sourceTerr: idx(hm,['TERR'])
    };
    const required = ['pre','code','office','grTradel','grBBVA','weight','mini','type','service','content','requestDate','deliveryDate'];
    const missing = required.filter(k=>col[k] < 0);
    if (missing.length) throw new Error('Faltan columnas obligatorias en la data: ' + missing.join(', '));

    const data = [];
    for (let i=headerIndex+1; i<rows.length; i++) {
      const r = rows[i];
      if (!r || !r.some(v => String(v ?? '').trim() !== '')) continue;
      const pre = String(r[col.pre] ?? '').trim();
      if (!pre) continue; // PRE vacío = no seleccionado para prefactura.
      data.push({
        _sourceRow: i+1,
        _raw: r.slice(),
        pre,
        code: r[col.code],
        office: String(r[col.office] ?? '').trim(),
        grTradel: String(r[col.grTradel] ?? '').trim(),
        grBBVA: String(r[col.grBBVA] ?? '').trim(),
        weight: r[col.weight],
        mini: String(r[col.mini] ?? '').trim(),
        type: String(r[col.type] ?? '').trim(),
        service: String(r[col.service] ?? '').trim(),
        content: String(r[col.content] ?? '').trim(),
        status: col.status >= 0 ? String(r[col.status] ?? '').trim() : '',
        requestDate: r[col.requestDate],
        deliveryDate: r[col.deliveryDate],
        sourceTerr: col.sourceTerr >= 0 ? String(r[col.sourceTerr] ?? '').trim() : ''
      });
    }
    if (!data.length) throw new Error('No se encontraron registros con PRE informado.');
    state.sourceHeaders = headers;
    return data;
  }

  function processOne(src, index) {
    const errors = [];
    const warnings = [];
    const mini = norm(src.mini);
    const type = norm(src.type);
    const service = norm(src.service);
    const code = String(src.code ?? '').trim();
    const weight = asNumber(src.weight);
    const deliveryIsFF = norm(src.deliveryDate) === 'FF';

    if (!code) errors.push('Código vacío.');
    if (!['SI','NO'].includes(mini)) errors.push('MINI debe ser SI o NO.');
    if (!['REG','EXP'].includes(type)) errors.push('TIPO debe ser REG o EXP.');
    if (!['ENTREGA','RECOJO','TRASLADO'].includes(service)) errors.push('SERVICIO debe ser ENTREGA, RECOJO o TRASLADO.');
    if (!Number.isFinite(weight) || weight <= 0) errors.push('PESO KG. debe ser mayor que 0.');
    if (String(src.deliveryDate ?? '').trim() === '') errors.push('FECHA DE ENTREGA vacía.');
    if (!src.grTradel) errors.push('GR TRADEL vacía.');
    if (!src.grBBVA) errors.push('GR BBVA vacía.');
    if (deliveryIsFF && service === 'TRASLADO' && mini !== 'SI') errors.push('TRASLADO con FF y MINI = NO: falta definir la regla de falso flete.');

    let tariff = null;
    if (code && ['SI','NO'].includes(mini) && ['REG','EXP'].includes(type)) {
      tariff = getMasterRecord(mini === 'SI' ? 'mini' : 'normal', code, type);
      if (tariff.error) errors.push(tariff.error);
      if (tariff.duplicateWarning) warnings.push(tariff.duplicateWarning);
    }

    let out = {
      _index:index, _sourceRow:src._sourceRow, src, errors, warnings,
      code, office:src.office, mini, type, service, weight,
      grTradel:src.grTradel, grBBVA:src.grBBVA, content:src.content, status:src.status || '',
      requestDate:src.requestDate, deliveryDate:src.deliveryDate
    };

    if (!errors.length && tariff) {
      const terr = tariff.terr;
      const ambit = terr === 'LC' ? 'LOCAL' : 'NACIONAL';
      const restWeight = weight <= 1 ? 0 : weight - 1;
      const kgFreight = restWeight * tariff.addKg;
      let falseFreight = 0;
      if (deliveryIsFF) {
        if (service === 'ENTREGA') falseFreight = tariff.firstKg + (0.35 * restWeight * tariff.addKg);
        else if (service === 'RECOJO') falseFreight = terr === 'LC' ? 2 : 8;
        else if (service === 'TRASLADO' && mini === 'SI') falseFreight = 8;
      }
      const freightTotal = deliveryIsFF ? falseFreight : tariff.firstKg + kgFreight;
      const igv = freightTotal * 0.18;
      const total = freightTotal + igv;
      const origin = service === 'RECOJO' ? tariff.destination : 'SAN ISIDRO';
      const destination = service === 'ENTREGA' ? tariff.destination : 'SAN ISIDRO';

      Object.assign(out, {
        tariffKind: mini === 'SI' ? 'MINI' : 'TARIFAS',
        terr, ambit, colum:type === 'REG' ? 1 : 2,
        condition:deliveryIsFF ? 'FALSO FLETE' : 'NORMAL',
        firstKg:tariff.firstKg, addKg:tariff.addKg, restWeight, kgFreight, falseFreight,
        freightTotal, igv, total, origin, destination,
        masterOffice:tariff.office
      });
    }
    return out;
  }

  function reprocess() {
    state.processed = state.sourceRows.map(processOne);
    state.review = state.processed.filter(r => r.errors.length > 0 || r.warnings.length > 0);
    const periods = [...new Set(state.sourceRows.map(r=>norm(r.pre)).filter(Boolean))];
    state.period = periods.length === 1 ? periods[0] : periods.join(' / ');
    if (periods.length > 1) {
      state.processed.forEach(r => r.errors.push('Hay más de un valor de PRE en el archivo. Carga un solo periodo por prefactura.'));
      state.review = state.processed.filter(r => r.errors.length > 0 || r.warnings.length > 0);
    }
    renderDashboard();
    renderReview();
    window.dispatchEvent(new CustomEvent('pref:data-updated'));
  }

  function outputRow(r) {
    return [
      r.src.pre, r.code, r.office, r.grTradel, r.grBBVA, r.weight, r.origin, r.destination, r.mini, r.type, r.service, r.content,
      excelDateToJS(r.requestDate) || r.requestDate,
      norm(r.deliveryDate)==='FF' ? 'FF' : (excelDateToJS(r.deliveryDate) || r.deliveryDate),
      r.ambit, r.colum, r.condition, r.terr, r.addKg, r.firstKg, r.restWeight, r.kgFreight, r.falseFreight, r.freightTotal, r.igv, r.total
    ];
  }

  async function handleDataFile(file) {
    if (!window.XLSX) return showToast('No está disponible el motor de Excel.', true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf,{type:'array',cellDates:false,cellStyles:false});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
      state.sourceRows = parseSource(rows);
      state.currentFile = file.name;
      $('loadedFileName').textContent = file.name;
      $('dashboard').classList.remove('hidden');
      reprocess();
      showToast(`Data cargada: ${state.sourceRows.length} registros seleccionados.`);
    } catch (e) {
      console.error(e);
      showToast(e.message || 'No se pudo leer el archivo.', true);
    }
  }

  function renderDashboard() {
    if (!state.processed.length) return;
    const valid = state.processed.filter(r=>!r.errors.length);
    const local = valid.filter(r=>r.terr==='LC').length;
    const national = valid.filter(r=>['AE','TE'].includes(r.terr)).length;
    const freight = valid.reduce((s,r)=>s+(r.freightTotal||0),0);
    const total = valid.reduce((s,r)=>s+(r.total||0),0);
    $('mRows').textContent = state.processed.length;
    $('mLocal').textContent = local;
    $('mNational').textContent = national;
    $('mReview').textContent = state.review.length;
    $('mFreight').textContent = money(freight);
    $('mTotal').textContent = money(total);
    $('periodPill').textContent = `PERIODO ${state.period || '—'}`;
    $('reviewBadge').textContent = state.review.length;
    $('reviewBadge').classList.toggle('hidden', state.review.length===0);
    const canGenerate = state.processed.length > 0 && state.review.length === 0;
    $('generateBtn').disabled = !canGenerate;
    $('generationMessage').textContent = canGenerate
      ? 'Todo está validado. Ya puedes generar la prefactura.'
      : `Hay ${state.review.length} registro(s) por revisar antes de generar.`;
    renderPreview();
  }

  function renderPreview() {
    const guideQuery = norm($('previewGuideSearch')?.value || '');
    const matched = guideQuery
      ? state.processed.filter(r => [r.grTradel,r.grBBVA].some(v => norm(v).includes(guideQuery)))
      : state.processed;
    const rows = matched.slice(0,50);
    const t = $('previewTable');
    t.innerHTML = `<thead><tr><th>Estado</th><th>Fila</th><th>COD</th><th>Oficina</th><th>GR TRADEL</th><th>GR BBVA</th><th>MINI</th><th>Tipo</th><th>Servicio</th><th>Peso</th><th>Terr.</th><th>Flete</th><th>Total</th></tr></thead><tbody>` + rows.map(r=>{
      const ok = r.errors.length===0 && r.warnings.length===0;
      return `<tr><td class="${ok?'status-ok':'status-bad'}">${ok?'LISTO':'REVISAR'}</td><td>${r._sourceRow}</td><td>${esc(r.code)}</td><td>${esc(r.office)}</td><td class="guide-cell">${esc(r.grTradel)}</td><td class="guide-cell">${esc(r.grBBVA)}</td><td>${esc(r.mini)}</td><td>${esc(r.type)}</td><td>${esc(r.service)}</td><td>${Number.isFinite(r.weight)?r.weight:''}</td><td>${esc(r.terr||'—')}</td><td>${r.freightTotal==null?'—':money(r.freightTotal)}</td><td>${r.total==null?'—':money(r.total)}</td></tr>`;
    }).join('') + `</tbody>`;
    $('previewCaption').textContent = guideQuery
      ? `Mostrando ${Math.min(50,matched.length)} de ${matched.length} coincidencia(s) por guía · ${state.processed.length} registros totales.`
      : `Mostrando ${Math.min(50,state.processed.length)} de ${state.processed.length} registros.`;
  }

  function reviewCategories(r) {
    const cats = new Set();
    const issues = [...r.errors, ...r.warnings].map(norm);
    if (norm(r.service) === 'TRASLADO') cats.add('TRASLADO');
    if (issues.some(x=>x.includes('FECHA DE ENTREGA VACIA'))) cats.add('FECHA');
    if (issues.some(x=>x.includes('TRASLADO CON FF'))) cats.add('TRASLADO_FF');
    if (issues.some(x=>x.includes('NO EXISTE EN MINI') || x.includes('NO EXISTE EN TARIFAS') || x.includes('FALTA LA TARIFA') || x.includes('TERRITORIO NO VALIDO') || x.includes('FALTA NOMBRE/CIUDAD'))) cats.add('TARIFA');
    if (issues.some(x=>x.includes('GR TRADEL') || x.includes('GR BBVA'))) cats.add('GUIAS');
    if (issues.some(x=>x.includes('PESO KG.'))) cats.add('PESO');
    if (issues.some(x=>x.includes('MINI DEBE') || x.includes('TIPO DEBE') || x.includes('SERVICIO DEBE') || x.includes('CODIGO VACIO'))) cats.add('DATOS');
    if (issues.some(x=>x.includes('DUPLICADO'))) cats.add('DUPLICADO');
    if (issues.some(x=>x.includes('MAS DE UN VALOR DE PRE'))) cats.add('PERIODO');
    if (!cats.size) cats.add('OTROS');
    return [...cats];
  }

  function reviewFilterLabel(key) {
    return ({
      ALL:'Todos',
      FECHA:'Falta fecha',
      TRASLADO:'Traslado',
      TRASLADO_FF:'Traslado FF',
      TARIFA:'Tarifa / código',
      GUIAS:'Guías',
      PESO:'Peso',
      DATOS:'Datos obligatorios',
      DUPLICADO:'Duplicados',
      PERIODO:'Periodo',
      OTROS:'Otros'
    })[key] || key;
  }

  function renderReview() {
    const review = state.review;
    $('reviewBadge').textContent = review.length;
    $('reviewBadge').classList.toggle('hidden', review.length===0);
    $('reviewEmpty').classList.toggle('hidden', review.length>0);
    $('reviewContent').classList.toggle('hidden', review.length===0);
    if (!review.length) {
      state.reviewFilter = 'ALL';
      return;
    }

    const order=['FECHA','TRASLADO','TRASLADO_FF','TARIFA','GUIAS','PESO','DATOS','DUPLICADO','PERIODO','OTROS'];
    const counts={ALL:review.length};
    for (const key of order) counts[key]=review.filter(r=>reviewCategories(r).includes(key)).length;
    if (state.reviewFilter !== 'ALL' && !counts[state.reviewFilter]) state.reviewFilter='ALL';

    const visible = state.reviewFilter === 'ALL'
      ? review
      : review.filter(r=>reviewCategories(r).includes(state.reviewFilter));

    $('reviewFilters').innerHTML = ['ALL',...order.filter(k=>counts[k]>0)].map(key =>
      `<button class="review-filter ${state.reviewFilter===key?'active':''}" data-filter="${key}">${esc(reviewFilterLabel(key))} <b>${counts[key]}</b></button>`
    ).join('');
    $('reviewFilterInfo').textContent = state.reviewFilter === 'ALL'
      ? `${review.length} registro(s) con observaciones.`
      : `Mostrando ${visible.length} de ${review.length} registro(s) · ${reviewFilterLabel(state.reviewFilter)}.`;

    $('reviewTable').innerHTML = `<thead><tr><th>Fila</th><th>COD</th><th>Oficina</th><th>GR TRADEL</th><th>GR BBVA</th><th>MINI</th><th>Tipo</th><th>Servicio</th><th>Peso</th><th>Observación</th><th></th></tr></thead><tbody>` + visible.map(r => {
      const issues = [...r.errors, ...r.warnings.map(w=>'ADVERTENCIA: '+w)];
      return `<tr><td>${r._sourceRow}</td><td>${esc(r.code)}</td><td>${esc(r.office)}</td><td class="guide-cell">${esc(r.grTradel)}</td><td class="guide-cell">${esc(r.grBBVA)}</td><td>${esc(r.mini)}</td><td>${esc(r.type)}</td><td>${esc(r.service)}</td><td>${Number.isFinite(r.weight)?r.weight:esc(r.src.weight)}</td><td class="issue-list">${issues.map(esc).join('<br>')}</td><td><button class="mini-button edit-source" data-index="${r._index}">Editar</button></td></tr>`;
    }).join('') + '</tbody>';

    qsa('.review-filter').forEach(b=>b.addEventListener('click',()=>{
      state.reviewFilter=b.dataset.filter;
      renderReview();
    }));
    qsa('.edit-source').forEach(b=>b.addEventListener('click',()=>openSourceEditor(Number(b.dataset.index))));
  }

  function openSourceEditor(index) {
    const r = state.sourceRows[index];
    if (!r) return;
    state.editSourceIndex = index;
    const fields = [
      ['pre','PRE','text'],['code','COD','text'],['office','OFICINA','text'],['grTradel','GR TRADEL','text'],['grBBVA','GR BBVA','text'],
      ['weight','PESO KG.','number'],['mini','MINI','select:SI,NO'],['type','TIPO','select:REG,EXP'],['service','SERVICIO','select:ENTREGA,RECOJO,TRASLADO'],
      ['requestDate','FECHA DE GUIA','text'],['deliveryDate','FECHA DE ENTREGA','text'],['content','CONTENIDO','textarea']
    ];
    $('rowFields').innerHTML = fields.map(([key,label,type]) => fieldHTML(key,label,type,r[key])).join('');
    $('rowDialog').showModal();
  }

  function fieldHTML(key,label,type,value) {
    if (type.startsWith('select:')) {
      const opts=type.split(':')[1].split(',');
      return `<div class="field"><label>${esc(label)}</label><select data-field="${key}">${opts.map(o=>`<option ${norm(value)===o?'selected':''}>${o}</option>`).join('')}</select></div>`;
    }
    if (type==='textarea') return `<div class="field" style="grid-column:1/-1"><label>${esc(label)}</label><textarea data-field="${key}">${esc(String(value??''))}</textarea></div>`;
    return `<div class="field"><label>${esc(label)}</label><input data-field="${key}" type="${type}" step="any" value="${esc(String(value??''))}"></div>`;
  }

  function saveSourceEditor(ev) {
    ev.preventDefault();
    const i=state.editSourceIndex; if (i==null) return;
    const r=state.sourceRows[i];
    qsa('#rowFields [data-field]').forEach(el => {
      const k=el.dataset.field;
      r[k] = k==='weight' ? (el.value==='' ? '' : Number(el.value)) : el.value;
    });
    $('rowDialog').close();
    reprocess();
    showToast('Registro actualizado y revalidado.');
  }

  function renderMaster() {
    const kind=state.activeMaster, rows=state.masters[kind], headers=rows[0]||[];
    const query=norm($('masterSearch').value);
    let indexed=rows.slice(1).map((r,i)=>({r,i:i+1}));
    if (query) indexed=indexed.filter(x => x.r.some(v=>norm(v).includes(query)));
    const shown=indexed.slice(0,250);
    $('masterInfo').textContent = `${kind==='normal'?'TARIFAS':'MINI'}: ${rows.length-1} filas. Mostrando ${shown.length}${indexed.length>250?' de '+indexed.length:''}.`;
    const th=headers.map(h=>`<th>${esc(String(h).replace(/\n/g,' '))}</th>`).join('')+'<th>Acción</th>';
    const tb=shown.map(x=>`<tr>${headers.map((_,j)=>`<td title="${esc(String(x.r[j]??''))}">${esc(String(x.r[j]??''))}</td>`).join('')}<td class="action-cell"><button class="mini-button edit-master" data-index="${x.i}">Editar</button></td></tr>`).join('');
    $('masterTable').innerHTML=`<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
    qsa('.edit-master').forEach(b=>b.addEventListener('click',()=>openMasterEditor(Number(b.dataset.index),false)));
  }

  function openMasterEditor(index, adding) {
    const rows=state.masters[state.activeMaster];
    const headers=rows[0]||[];
    const row=adding ? Array(headers.length).fill('') : (rows[index]||[]).slice();
    state.editMasterIndex=index;
    state.masterAdding=adding;
    $('masterDialogTitle').textContent=adding?'Agregar tarifa':'Editar tarifa';
    $('masterFields').innerHTML=headers.map((h,j)=>`<div class="field"><label>${esc(String(h).replace(/\n/g,' '))}</label><input data-col="${j}" value="${esc(String(row[j]??''))}"></div>`).join('');
    $('masterDialog').showModal();
  }

  function saveMasterEditor(ev) {
    ev.preventDefault();
    const rows=state.masters[state.activeMaster];
    const headers=rows[0]||[];
    const row=Array(headers.length).fill('');
    qsa('#masterFields [data-col]').forEach(el=>{
      const j=Number(el.dataset.col); let v=el.value.trim();
      const n=asNumber(v);
      if (v!=='' && Number.isFinite(n) && /KG|COD|TE -|1KG|ADICIONAL/i.test(String(headers[j]))) v=n;
      row[j]=v;
    });
    if (state.masterAdding) rows.push(row); else rows[state.editMasterIndex]=row;
    saveMaster(state.activeMaster);
    $('masterDialog').close();
    renderMaster();
    if (state.sourceRows.length) reprocess();
    showToast('Tarifario actualizado.');
  }

  async function importMaster(file) {
    try {
      const kind=state.activeMaster;
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:false});
      const desired=kind==='normal'?'TARIFAS':'MINI';
      const sheetName=wb.SheetNames.find(n=>norm(n)===desired) || wb.SheetNames[0];
      let rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true});
      rows=rows.filter(r=>r.some(v=>String(v??'').trim()!==''));
      if (rows.length<2) throw new Error('El tarifario no contiene datos.');
      const hm=headerMap(rows[0]);
      const needed=['COD','OFICINA','TIPO REG','TIPO EXP','NOMBRE'];
      const miss=needed.filter(h=>!hm.has(h));
      if (miss.length) throw new Error('Faltan columnas en el tarifario: '+miss.join(', '));
      if (!confirm(`Se reemplazará el maestro ${desired} actual por ${rows.length-1} filas. ¿Continuar?`)) return;
      state.masters[kind]=rows;
      saveMaster(kind);
      renderMaster();
      if (state.sourceRows.length) reprocess();
      showToast(`${desired} actualizado desde Excel.`);
    } catch(e) { console.error(e); showToast(e.message||'No se pudo importar el tarifario.',true); }
    finally { $('masterFile').value=''; }
  }

  function restoreMaster() {
    const kind=state.activeMaster;
    if (!confirm(`¿Restaurar ${kind==='normal'?'TARIFAS':'MINI'} al maestro original incluido con esta versión?`)) return;
    state.masters[kind]=cloneRows(kind==='normal'?window.DEFAULT_MASTERS.tarifas:window.DEFAULT_MASTERS.mini);
    saveMaster(kind); renderMaster(); if(state.sourceRows.length) reprocess(); showToast('Maestro original restaurado.');
  }

  function styleMasterSheet(ws, rowCount, colCount, kind) {
    const headerStyle={fill:{fgColor:{rgb:'222222'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:thinBorders()};
    const bodyStyle={font:{name:'Calibri',sz:9,color:{rgb:'222222'}},alignment:{vertical:'center'},border:thinBorders()};
    for(let c=0;c<colCount;c++) setStyle(ws,0,c,headerStyle);
    for(let r=1;r<rowCount;r++) for(let c=0;c<colCount;c++) setStyle(ws,r,c,bodyStyle);
    ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(colCount-1)}${rowCount}`};
    ws['!freeze']={xSplit:0,ySplit:1};
    ws['!cols']=Array.from({length:colCount},(_,i)=>({wch:i===1?34:(i===colCount-1?23:15)}));
    if(kind==='mini') ws['!cols'][1]={wch:34};
  }

  function serviceSheet(rows) {
    const aoa=[OUTPUT_HEADERS, ...rows.map(outputRow)];
    const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true});
    const headerColors=['FFFFFF','FFFFFF','FFFFFF','FF5AA7','FF5AA7','FF5AA7','FFFFFF','FFFFFF','57C785','FF5AA7','FF5AA7','FF5AA7','FF5AA7','FF5AA7','FFFFFF','FFFFFF','FFFFFF','FFD84D','FFD84D','FFA94D','FFFFFF','FFFFFF','FFFFFF','FFD84D','FFA94D','FF4D4D'];
    const headerStyleBase={fill:{fgColor:{rgb:'111111'}},font:{bold:true,sz:9},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:thinBorders()};
    for(let c=0;c<OUTPUT_HEADERS.length;c++) {
      setStyle(ws,0,c,{...headerStyleBase,font:{...headerStyleBase.font,color:{rgb:headerColors[c]}}});
    }
    const body={font:{name:'Calibri',sz:9,color:{rgb:'111111'}},alignment:{vertical:'center'},border:thinBorders()};
    const solesFmt='"S/" #,##0.00';
    for(let r=1;r<=rows.length;r++) {
      for(let c=0;c<OUTPUT_HEADERS.length;c++) setStyle(ws,r,c,body);
      // highlighted operational columns, similar to the current workbook
      ['A','I','J','K','R','S','T','X','Y','Z'].forEach(col=>{
        const cell=ws[`${col}${r+1}`]; if(cell) cell.s={...(cell.s||{}),font:{...(cell.s?.font||body.font),bold:['A','J','K','R','X','Z'].includes(col)}};
      });
      // Columnas de precio en formato soles: TAR x Kg, 1er kilo, flete calculado, FF, flete total, IGV y total.
      for(const c of [18,19,21,22,23,24,25]) {
        const cell=ws[XLSX.utils.encode_cell({r,c})]; if(cell) cell.z=solesFmt;
      }
      const weightCell=ws[XLSX.utils.encode_cell({r,c:5})]; if(weightCell) weightCell.z='0.00';
      const restCell=ws[XLSX.utils.encode_cell({r,c:20})]; if(restCell) restCell.z='0.00';
      for(const c of [12,13]) {
        const cell=ws[XLSX.utils.encode_cell({r,c})];
        if(cell && cell.t==='d') cell.z='dd/mm/yyyy';
      }
    }

    // Totales al pie de cada hoja de servicio.
    const totalRow=rows.length+1; // índice base 0; queda debajo de la última fila de datos
    const freightTotal=rows.reduce((s,r)=>s+Number(r.freightTotal||0),0);
    const igvTotal=rows.reduce((s,r)=>s+Number(r.igv||0),0);
    const grandTotal=rows.reduce((s,r)=>s+Number(r.total||0),0);
    XLSX.utils.sheet_add_aoa(ws,[['TOTAL:',freightTotal,igvTotal,grandTotal]],{origin:{r:totalRow,c:22}}); // W:Z
    const totalLabelStyle={fill:{fgColor:{rgb:'222222'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},alignment:{horizontal:'right',vertical:'center'},border:thinBorders()};
    const totalValueStyle={fill:{fgColor:{rgb:'FFF2CC'}},font:{bold:true,color:{rgb:'111111'},sz:10},alignment:{horizontal:'right',vertical:'center'},border:thinBorders()};
    setStyle(ws,totalRow,22,totalLabelStyle);
    for(const c of [23,24,25]) {
      setStyle(ws,totalRow,c,totalValueStyle);
      const cell=ws[XLSX.utils.encode_cell({r:totalRow,c})]; if(cell) cell.z=solesFmt;
    }

    ws['!autofilter']={ref:`A1:Z${Math.max(1,rows.length+1)}`};
    ws['!freeze']={xSplit:0,ySplit:1};
    ws['!rows']=[{hpt:32}];
    ws['!cols']=[
      {wch:11},{wch:8},{wch:29},{wch:16},{wch:16},{wch:10},{wch:15},{wch:15},{wch:7},{wch:7},{wch:10},{wch:52},{wch:14},{wch:14},
      {wch:11},{wch:8,hidden:true},{wch:14,hidden:true},{wch:9},{wch:11},{wch:11},{wch:11},{wch:14},{wch:15},{wch:13},{wch:11},{wch:12}
    ];
    return ws;
  }

  function summarySheet(validRows) {
    const c={LC:{flete:0,igv:0,total:0},AE:{flete:0,igv:0,total:0},TE:{flete:0,igv:0,total:0}};
    validRows.forEach(r=>{ const k=c[r.terr]; if(k){k.flete+=Number(r.freightTotal||0);k.igv+=Number(r.igv||0);k.total+=Number(r.total||0);} });

    // Un único cuadro consolidado: REG + EXP juntos.
    const data=Array.from({length:20},()=>Array(9).fill(''));
    data[0][1]='SERVICIO CONSOLIDADO';
    data[2].splice(1,4,'TIPO TRANSP.','FLETE','IGV','TOTAL');
    putSummaryTransport(data,3,'AEREO',c.AE);
    // Se conserva la información auxiliar que tenía el resumen original.
    data[4][2]=c.AE.flete; data[4][3]=c.AE.igv; data[4][4]=c.AE.total; data[4][5]='FAC. AEREA';
    data[3][7]=c.AE.flete*0.003; data[3][8]=c.AE.flete-(c.AE.flete*0.003);

    data[9].splice(1,4,'TIPO TRANSP.','FLETE','IGV','TOTAL');
    putSummaryTransport(data,10,'LOCAL',c.LC);
    putSummaryTransport(data,11,'TERRESTRE',c.TE);
    data[12][2]=c.LC.flete+c.TE.flete; data[12][3]=c.LC.igv+c.TE.igv; data[12][4]=c.LC.total+c.TE.total; data[12][5]='FAC. TERR';
    const facTerrRet=data[12][2]*0.003; const facTerrNeto=data[12][2]-facTerrRet; data[12][7]=facTerrRet; data[12][8]=facTerrNeto;

    data[16][1]='TOTAL:';
    data[16][2]=c.AE.flete+c.LC.flete+c.TE.flete;
    data[16][3]=c.AE.igv+c.LC.igv+c.TE.igv;
    data[16][4]=c.AE.total+c.LC.total+c.TE.total;

    const ws=XLSX.utils.aoa_to_sheet(data);
    ws['!merges']=[XLSX.utils.decode_range('B1:E1')];
    const section={fill:{fgColor:{rgb:'1B8F68'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:12},alignment:{horizontal:'center',vertical:'center'},border:thinBorders()};
    const hdr={fill:{fgColor:{rgb:'333333'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},alignment:{horizontal:'center'},border:thinBorders()};
    const box={font:{name:'Calibri',sz:10},border:thinBorders()};
    const totalStyle={fill:{fgColor:{rgb:'FFF2CC'}},font:{name:'Calibri',sz:10,bold:true},border:thinBorders()};
    for(let cix=1;cix<=4;cix++) setStyle(ws,0,cix,section);
    for(const r of [2,9]) for(let cix=1;cix<=4;cix++) setStyle(ws,r,cix,hdr);
    for(const range of ['B4:I7','B11:I15']) {
      const dr=XLSX.utils.decode_range(range); for(let rr=dr.s.r;rr<=dr.e.r;rr++) for(let cc=dr.s.c;cc<=dr.e.c;cc++) setStyle(ws,rr,cc,box);
    }
    for(let cix=1;cix<=4;cix++) setStyle(ws,16,cix,totalStyle);
    const solesFmt='"S/" #,##0.00';
    for(let r=0;r<20;r++) for(let cix=2;cix<=4;cix++) { const cell=ws[XLSX.utils.encode_cell({r,c:cix})]; if(cell && typeof cell.v==='number') cell.z=solesFmt; }
    for(const rc of [[3,7],[3,8],[12,7],[12,8]]) { const cell=ws[XLSX.utils.encode_cell({r:rc[0],c:rc[1]})]; if(cell) cell.z=solesFmt; }
    // Resaltar los subtotales de factura AÉREA y TERRESTRE/LOCAL, tal como el formato modelo.
    const facSubtotalStyle={fill:{fgColor:{rgb:'E2F0D9'}},font:{name:'Calibri',sz:10,bold:true,color:{rgb:'111111'}},alignment:{horizontal:'right'},border:thinBorders()};
    for(const r of [4,12]) for(let cix=2;cix<=4;cix++) setStyle(ws,r,cix,facSubtotalStyle);

    // A la derecha, retención y neto deben quedar destacados con negrita, sin fondo.
    const facRightStyle={font:{name:'Calibri',sz:10,bold:true,color:{rgb:'111111'}},alignment:{horizontal:'right'}};
    for(const rc of [[3,7],[3,8],[12,7],[12,8]]) setStyle(ws,rc[0],rc[1],facRightStyle);
    ws['!cols']=[{wch:3},{wch:20},{wch:15},{wch:15},{wch:15},{wch:14},{wch:4},{wch:15},{wch:15}];
    ws['!rows']=[{hpt:24}];
    return ws;
  }

  function summaryForType(rows,type) {
    const z={LC:{flete:0,igv:0,total:0},AE:{flete:0,igv:0,total:0},TE:{flete:0,igv:0,total:0}};
    rows.filter(r=>r.type===type).forEach(r=>{ const k=z[r.terr]; if(k){k.flete+=r.freightTotal;k.igv+=r.igv;k.total+=r.total;} });
    return z;
  }
  function putSummaryTransport(data,row,label,v){data[row][1]=label;data[row][2]=v.flete;data[row][3]=v.igv;data[row][4]=v.total;}

  function thinBorders(){ const side={style:'thin',color:{rgb:'D9D9D9'}}; return {top:side,bottom:side,left:side,right:side}; }
  function setStyle(ws,r,c,s){const ref=XLSX.utils.encode_cell({r,c});if(ws[ref])ws[ref].s=s;}

  function workbookFromCurrent() {
    const valid=state.processed.filter(r=>r.errors.length===0 && r.warnings.length===0);
    const local=valid.filter(r=>r.terr==='LC');
    const national=valid.filter(r=>['AE','TE'].includes(r.terr));
    const wb=XLSX.utils.book_new();

    const miniWS=XLSX.utils.aoa_to_sheet(state.masters.mini);
    styleMasterSheet(miniWS,state.masters.mini.length,state.masters.mini[0].length,'mini');
    XLSX.utils.book_append_sheet(wb,miniWS,'MINI');

    const normalWS=XLSX.utils.aoa_to_sheet(state.masters.normal);
    styleMasterSheet(normalWS,state.masters.normal.length,state.masters.normal[0].length,'normal');
    XLSX.utils.book_append_sheet(wb,normalWS,'TARIFAS');

    XLSX.utils.book_append_sheet(wb,serviceSheet(local),'SERVICIO LOCAL');
    XLSX.utils.book_append_sheet(wb,serviceSheet(national),'SERVICIO NACIONAL');
    XLSX.utils.book_append_sheet(wb,summarySheet(valid),'RESUMEN MENSUAL');
    return {wb,valid};
  }

  function generateWorkbook() {
    if (state.review.length || !state.processed.length) return showToast('Primero subsana todas las observaciones.',true);
    try {
      const {wb,valid}=workbookFromCurrent();
      const year=yearFromRows(valid);
      const period=(state.period||'MES').replace(/[\\/:*?"<>|]/g,'-');
      const filename=`PRE FACT- ${period} ${year} - INFORMATICA.xlsx`;
      XLSX.writeFile(wb,filename,{bookType:'xlsx',compression:true,cellStyles:true});
      const total=valid.reduce((s,r)=>s+r.total,0);
      state.history.unshift({date:new Date().toISOString(),period,year,rows:valid.length,total,filename});
      saveHistory(); renderHistory();
      showToast('Prefactura generada correctamente.');
    } catch(e) { console.error(e); showToast('No se pudo generar el Excel: '+(e.message||e),true); }
  }

  function exportMasters() {
    try {
      const wb=XLSX.utils.book_new();
      const a=XLSX.utils.aoa_to_sheet(state.masters.mini); styleMasterSheet(a,state.masters.mini.length,state.masters.mini[0].length,'mini');
      const b=XLSX.utils.aoa_to_sheet(state.masters.normal); styleMasterSheet(b,state.masters.normal.length,state.masters.normal[0].length,'normal');
      XLSX.utils.book_append_sheet(wb,a,'MINI'); XLSX.utils.book_append_sheet(wb,b,'TARIFAS');
      XLSX.writeFile(wb,'RESPALDO TARIFARIOS - INFORMATICA.xlsx',{bookType:'xlsx',compression:true,cellStyles:true});
      showToast('Respaldo de tarifarios generado.');
    } catch(e) { showToast('No se pudo generar el respaldo.',true); }
  }

  function renderHistory() {
    const box=$('historyList');
    if(!state.history.length){box.innerHTML='<div class="empty-state"><div>◷</div><strong>Aún no hay prefacturas generadas</strong><span>Los próximos archivos aparecerán aquí.</span></div>';return;}
    box.innerHTML=state.history.map(h=>`<div class="history-item"><div><strong>${esc(h.period)} ${h.year}</strong><br><span>${new Date(h.date).toLocaleString('es-PE')} · ${h.rows} registros · ${esc(h.filename)}</span></div><span class="history-amount">${money(h.total)}</span></div>`).join('');
  }

  function setView(view) {
    qsa('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    qsa('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
    const titles={nueva:['Nueva prefactura','Carga la data mensual, valida y genera el Excel final.'],revision:['Por revisar','Subsanación obligatoria antes de generar.'],tarifarios:['Tarifarios','Administra los maestros normal y Mini Almacén.'],indicadores:['Indicadores','Lead times, cumplimiento y reportes del periodo.'],historial:['Historial','Resumen local de archivos generados.']};
    $('viewTitle').textContent=titles[view][0]; $('viewSubtitle').textContent=titles[view][1];
    if(view==='tarifarios') renderMaster(); if(view==='indicadores' && window.PREF_REPORT) window.PREF_REPORT.render(); if(view==='historial') renderHistory();
  }

  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  let toastTimer;
  function showToast(msg,error=false){const t=$('toast');t.textContent=msg;t.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',3300);}

  function initEvents() {
    qsa('.nav-btn').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
    $('dataFile').addEventListener('change',e=>e.target.files[0]&&handleDataFile(e.target.files[0]));
    const dz=$('dropZone');
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
    dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)handleDataFile(f);});
    $('goReview').addEventListener('click',()=>setView('revision'));
    $('previewGuideSearch')?.addEventListener('input',renderPreview);
    $('revalidateBtn').addEventListener('click',()=>{reprocess();showToast('Validación actualizada.');});
    $('generateBtn').addEventListener('click',generateWorkbook);
    $('saveRow').addEventListener('click',saveSourceEditor);
    $('saveMaster').addEventListener('click',saveMasterEditor);
    qsa('.master-tab').forEach(b=>b.addEventListener('click',()=>{state.activeMaster=b.dataset.master;qsa('.master-tab').forEach(x=>x.classList.toggle('active',x===b));$('masterSearch').value='';renderMaster();}));
    $('masterSearch').addEventListener('input',renderMaster);
    $('masterFile').addEventListener('change',e=>e.target.files[0]&&importMaster(e.target.files[0]));
    $('addMasterRow').addEventListener('click',()=>openMasterEditor(state.masters[state.activeMaster].length,true));
    $('restoreMaster').addEventListener('click',restoreMaster);
    $('exportMasters').addEventListener('click',exportMasters);
    $('clearHistory').addEventListener('click',()=>{if(confirm('¿Limpiar el historial local?')){state.history=[];saveHistory();renderHistory();}});
  }

  function init() {
    if (!window.DEFAULT_MASTERS) {
      document.body.innerHTML='<div style="padding:30px;font-family:Arial">No se encontraron los maestros incluidos (defaults.js).</div>';
      return;
    }
    loadMasters(); loadHistory(); initEvents(); renderHistory();
    setTimeout(()=>{ if(!window.XLSX) $('libWarning').classList.remove('hidden'); },3500);
  }

  function applyDeliveryDateUpdates(updates){
    if(!Array.isArray(updates)) return;
    for(const u of updates){
      const i=Number(u?.index);
      if(!Number.isInteger(i) || i<0 || i>=state.sourceRows.length) continue;
      state.sourceRows[i].deliveryDate=u.deliveryDate;
    }
    reprocess();
  }

  window.PREF_APP = {
    getState:()=>state,
    getValidRows:()=>state.processed.filter(r=>r.errors.length===0 && r.warnings.length===0),
    applyDeliveryDateUpdates,
    norm, asNumber, money, excelDateToJS, dateText, yearFromRows, showToast
  };

  document.addEventListener('DOMContentLoaded',init);
})();
