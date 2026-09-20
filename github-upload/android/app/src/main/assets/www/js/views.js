/* ============================================================
 * 视图渲染层：只把数据变成 DOM，不含业务状态
 * ============================================================ */
(function (global) {
  'use strict';

  var S = global.YM_STORE;
  var M = global.YM_MATCH;

  var WD_CN = ['日', '一', '二', '三', '四', '五', '六'];
  var REPEAT_CN = { none: '', daily: '每天', weekday: '工作日', weekly: '每周', monthly: '每月' };
  var TONE_CN = { strict: '要求', warm: '体谅', clear: '说明' };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isOverdue(x) {
    if (x.done || !x.start) return false;
    return new Date(x.date + 'T' + x.start + ':00').getTime() < Date.now();
  }

  function moodLine(picked) {
    var pool = global.YM_MOOD_TEXT[picked.mood.key] || [''];
    var i = Math.abs(hashStr(picked.quote.id + picked.mood.key)) % pool.length;
    return pool[i];
  }
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  /* ======================= 今日 ======================= */
  function taskHTML(x) {
    var meta = [];
    if (x.start) meta.push('<span class="t-time' + (isOverdue(x) ? ' overdue' : '') + '">' + x.start + (x.end ? '–' + x.end : '') + '</span>');
    else meta.push('<span class="t-time">全天</span>');
    (x.tags || []).forEach(function (t) { meta.push('<span class="t-tag">' + esc(t) + '</span>'); });
    if (x.repeat && x.repeat !== 'none') meta.push('<span class="t-repeat">' + REPEAT_CN[x.repeat] + '</span>');
    if (x.remindOn && x.start) meta.push('<span class="t-repeat">提醒 ' + (x.remindBefore === 0 ? '准时' : '提前' + x.remindBefore + '分') + '</span>');

    return '<li class="task' + (x.done ? ' done' : '') + '" data-inst="' + esc(x.instId) + '" data-item="' + esc(x.id) + '" data-date="' + esc(x.date) + '">' +
      '<span class="check"></span>' +
      '<div class="t-body">' +
        '<div class="t-title">' + esc(x.title) + '</div>' +
        (x.note ? '<div class="t-note">' + esc(x.note) + '</div>' : '') +
        '<div class="t-meta">' + meta.join('') + '</div>' +
      '</div>' +
    '</li>';
  }

  function renderToday(dateStr, el) {
    var st = S.dayStats(dateStr);
    var isToday = dateStr === S.today();
    var fb = S.feedbackFor(dateStr);

    var picked = M.pick(st.list, dateStr, global.YM_APP ? global.YM_APP.quoteSalt : 0, {
      liked: fb.liked, disliked: fb.disliked
    });
    var q = picked.quote;
    el.quoteTheme.textContent = q.theme;
    var c = global.YM_THEME_COLORS[q.theme] || '#B23A2C';
    el.quoteTheme.style.borderColor = c;
    el.quoteTheme.style.color = c;
    el.quoteText.textContent = q.text;
    el.quoteSrc.textContent = '—— ' + q.src;
    el.quoteReason.textContent = picked.reason;
    el.quoteReason.hidden = S.load().settings.showReason === false;
    if (el.btnLike) {
      el.btnLike.classList.toggle('on', fb.liked.indexOf(q.id) !== -1);
    }
    global.YM_APP.lastPick = picked;

    var pct = Math.round(st.rate * 100);
    el.ringFg.style.strokeDashoffset = String(326.7 * (1 - st.rate));
    el.ringPct.textContent = pct + '%';

    el.todayTitle.textContent = isToday ? '今日' : (S.parseDate(dateStr).getMonth() + 1) + '月' + S.parseDate(dateStr).getDate() + '日 周' + WD_CN[S.weekday(dateStr)];
    el.todayMeta.textContent = st.total ? '已完成 ' + st.done + ' / ' + st.total + ' 项' : '还没有安排';
    el.todayMood.textContent = moodLine(picked);

    el.todayList.innerHTML = st.list.map(taskHTML).join('');
    el.todayCount.textContent = st.total ? st.total + ' 项' : '';
    el.todayEmpty.hidden = st.total > 0 || !S.load().settings.startedAt;
  }

  /* ======================= 逾期块 ======================= */
  function renderOverdue(dateStr, el) {
    var list = S.overdueBefore(dateStr);
    el.block.hidden = list.length === 0;
    if (!list.length) return;
    var days = {};
    list.forEach(function (x) { days[x.date] = 1; });
    el.head.textContent = '过去 ' + Object.keys(days).length + ' 天里，有 ' + list.length + ' 件没划掉';
    el.list.innerHTML = list.slice(0, 12).map(function (x) {
      var d = S.parseDate(x.date);
      return '<li class="od-item" data-item="' + esc(x.id) + '" data-date="' + esc(x.date) + '">' +
        '<span class="od-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
        '<span class="od-title">' + esc(x.title) + '</span>' +
        '<button class="od-act" data-act="done">已做</button>' +
        '<button class="od-act" data-act="move">顺延</button>' +
      '</li>';
    }).join('') + (list.length > 12 ? '<li class="od-more">还有 ' + (list.length - 12) + ' 件…</li>' : '');
  }

  /* ======================= 日历 ======================= */
  function dayCell(dateStr, selected) {
    var st = S.dayStats(dateStr);
    var cls = 'daycell';
    if (dateStr === S.today()) cls += ' today';
    if (dateStr === selected) cls += ' sel';
    var dotCls = 'dot';
    if (st.total && st.done >= st.total) dotCls += ' full';
    else if (st.done > 0) dotCls += ' partial';
    return '<div class="' + cls + '" data-date="' + dateStr + '"><span class="n">' + S.parseDate(dateStr).getDate() + '</span>' +
      (st.total ? '<span class="' + dotCls + '"></span>' : '<span class="dot" style="opacity:0"></span>') + '</div>';
  }

  function dayView(anchor, el) {
    var html = '<div class="day-list-title">' + anchor.replace(/-/g, '/') + ' 周' + WD_CN[S.weekday(anchor)] + '</div>';
    var st = S.dayStats(anchor);
    html += '<ul class="task-list">' + (st.total ? st.list.map(taskHTML).join('') : '') + '</ul>';
    if (!st.total) html += '<div class="empty"><p>这天没有安排。</p><p class="dim">点「＋」添加。</p></div>';
    el.innerHTML = html;
  }

  function weekView(anchor, el) {
    var w = S.weekStats(anchor);
    var html = '<div class="weekcols">';
    w.days.forEach(function (d) {
      var pct = Math.round(d.rate * 100);
      var dt = S.parseDate(d.date);
      html += '<div class="wcol' + (d.date === S.today() ? ' today' : '') + '" data-date="' + d.date + '">' +
        '<div class="whead">周' + WD_CN[S.weekday(d.date)] + '<b>' + dt.getDate() + '</b></div>' +
        '<div class="wbar"><div class="wfill" style="height:' + pct + '%"></div></div>' +
        '<div class="wn">' + d.done + '/' + d.total + '</div>' +
      '</div>';
    });
    html += '</div>';
    var total = w.days.reduce(function (a, x) { return a + x.total; }, 0);
    var done = w.days.reduce(function (a, x) { return a + x.done; }, 0);
    html += '<p class="hint">本周共 ' + total + ' 项，完成 ' + done + ' 项，完成率 ' + (total ? Math.round(done / total * 100) : 0) + '%。</p>';
    html += '<div class="day-list-title" data-date="' + anchor + '">' + anchor.replace(/-/g, '/') + ' 周' + WD_CN[S.weekday(anchor)] + ' 的安排</div>';
    var st = S.dayStats(anchor);
    html += '<ul class="task-list">' + (st.total ? st.list.map(taskHTML).join('') : '<li class="hint" style="list-style:none">这天没有安排</li>') + '</ul>';
    el.innerHTML = html;
  }

  function monthView(anchor, el) {
    var d = S.parseDate(anchor);
    var ms = S.monthStats(d.getFullYear(), d.getMonth());
    var html = '<div class="weekgrid wdrow">' + WD_CN.map(function (x) { return '<div class="wd">' + x + '</div>'; }).join('') + '</div>';
    html += '<div class="monthgrid">';
    var first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    var lead = first === 0 ? 6 : first - 1;
    for (var i = 0; i < lead; i++) html += '<div class="daycell out"></div>';
    ms.days.forEach(function (x) { html += dayCell(x.date, anchor); });
    html += '</div>';
    html += '<p class="hint">本月 ' + ms.total + ' 项，完成 ' + ms.done + ' 项，完成率 ' + Math.round(ms.rate * 100) + '%。</p>';
    el.innerHTML = html;
  }

  function yearView(anchor, el) {
    var y = S.parseDate(anchor).getFullYear();
    var ys = S.yearStats(y);
    var html = '<p class="hint">' + y + ' 年共 ' + ys.total + ' 项，完成 ' + ys.done + ' 项，完成率 ' + Math.round(ys.rate * 100) + '%。</p>';
    html += '<div class="heat">';
    ys.cells.forEach(function (c) {
      if (c.out || !c.stat || !c.stat.total) { html += '<i class="' + (c.out ? 'out' : '') + '"></i>'; return; }
      var r = c.stat.rate;
      var lv = r >= 0.999 ? 'l4' : r >= 0.66 ? 'l3' : r >= 0.34 ? 'l2' : 'l1';
      html += '<i class="' + lv + '" title="' + c.date + ' ' + c.stat.done + '/' + c.stat.total + '" data-date="' + c.date + '"></i>';
    });
    html += '</div><div class="monthminis">';
    ys.months.forEach(function (m, idx) {
      var first = new Date(y, idx, 1).getDay();
      var lead = first === 0 ? 6 : first - 1;
      var cells = '';
      for (var i = 0; i < lead; i++) cells += '<u style="opacity:.28"></u>';
      m.days.forEach(function (x) {
        var r = x.rate;
        var bg = !x.total ? 'var(--paper-3)' : r >= 0.999 ? 'var(--seal)' : r >= 0.5 ? '#DDAFA7' : r > 0 ? '#EBD9D5' : 'var(--paper-3)';
        cells += '<u style="background:' + bg + '" title="' + x.date + '"></u>';
      });
      html += '<div class="mini"><h4>' + (idx + 1) + '月<em>' + Math.round(m.rate * 100) + '%</em></h4><div class="mg">' + cells + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function renderCalendar(scope, anchor, el) {
    if (scope === 'day') dayView(anchor, el);
    else if (scope === 'week') weekView(anchor, el);
    else if (scope === 'month') monthView(anchor, el);
    else yearView(anchor, el);
  }

  /* ======================= 数据 ======================= */
  function renderStats(el) {
    var today = S.today();
    var y = S.parseDate(today).getFullYear();
    var ys = S.yearStats(y);
    el.sTotal.textContent = ys.total;
    el.sDone.textContent = ys.done;
    el.sRate.textContent = Math.round(ys.rate * 100) + '%';

    var streak = 0, d = today;
    for (var i = 0; i < 400; i++) {
      var st = S.dayStats(d);
      if (st.total === 0) { d = S.shift(d, -1); continue; }
      if (st.rate >= 0.6) { streak++; d = S.shift(d, -1); } else break;
    }
    el.sStreak.textContent = streak;

    var series = [];
    for (var k = 29; k >= 0; k--) series.push(S.dayStats(S.shift(today, -k)));
    drawTrend(el.trendChart, series);

    var dist = S.tagDistribution(S.shift(today, -29), today).slice(0, 8);
    var max = dist.length ? dist[0].n : 1;
    el.tagBars.innerHTML = dist.length ? dist.map(function (t) {
      return '<div class="tagbar"><b>' + esc(t.tag) + '</b><div class="bar"><i style="width:' + Math.round(t.n / max * 100) + '%"></i></div><em>' + t.n + '</em></div>';
    }).join('') : '<p class="hint">还没有足够的数据。</p>';

    var ov = S.overdueBefore(today).length;
    el.quoteStatHint.textContent = '语录不是随机抽的：它读你日程里的意思，再结合完成情况挑主题。'
      + '完成得多就给你松一点的话，落下得多了就给你能站住的话——但不会在你累的时候教训你。'
      + (ov ? '现在还有 ' + ov + ' 件逾期未划掉，在「今日」页可以一键顺延。' : '');
  }

  function drawTrend(canvas, series) {
    if (!canvas || !canvas.getContext) return;
    var ctx;
    try { ctx = canvas.getContext('2d'); } catch (e) { return; }
    if (!ctx) return;
    var dpr = global.devicePixelRatio || 1;
    var w = canvas.clientWidth || 320;
    var h = canvas.clientHeight || 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 26, padR = 6, padT = 10, padB = 18;
    var cw = w - padL - padR, ch = h - padT - padB;
    ctx.strokeStyle = '#EAE4D8'; ctx.lineWidth = 1;
    ctx.font = '10px -apple-system,sans-serif'; ctx.fillStyle = '#8C857A';
    [0, 0.5, 1].forEach(function (v) {
      var yy = padT + ch * (1 - v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(Math.round(v * 100) + '%', 2, yy + 3);
    });
    var n = series.length;
    var bw = Math.max(3, cw / n - 3);
    series.forEach(function (s, i) {
      var x = padL + (cw / n) * i + (cw / n - bw) / 2;
      var bh = ch * (s.total ? s.rate : 0);
      ctx.fillStyle = s.total ? '#B23A2C' : '#EAE4D8';
      ctx.globalAlpha = s.total ? 0.82 : 1;
      roundRect(ctx, x, padT + ch - bh, bw, Math.max(bh, s.total ? 2 : 0), 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = '#8C857A';
    ctx.fillText('30 天前', padL, h - 4);
    ctx.fillText('今天', w - padR - 24, h - 4);
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (!w || !h) return;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ======================= 语录库（416 条，必须分页） ======================= */
  function filterQuotes(query, theme) {
    var list = global.YM_QUOTES;
    if (theme) list = list.filter(function (q) { return q.theme === theme; });
    if (query) {
      var k = query.trim().toLowerCase();
      list = list.filter(function (q) {
        return q.text.toLowerCase().indexOf(k) !== -1 ||
          q.src.toLowerCase().indexOf(k) !== -1 ||
          q.theme.indexOf(k) !== -1 ||
          (q.tone && TONE_CN[q.tone] && TONE_CN[q.tone].indexOf(k) !== -1) ||
          q.tags.some(function (t) { return t.indexOf(k) !== -1; });
      });
    }
    return list;
  }

  function renderLibThemes(el, active) {
    var themes = Object.keys(global.YM_THEMES);
    var counts = {};
    global.YM_QUOTES.forEach(function (q) { counts[q.theme] = (counts[q.theme] || 0) + 1; });
    el.innerHTML = '<button class="chip sm' + (!active ? ' active' : '') + '" data-theme="">全部 ' + global.YM_QUOTES.length + '</button>' +
      themes.map(function (t) {
        return '<button class="chip sm' + (active === t ? ' active' : '') + '" data-theme="' + t + '">' + t + ' ' + (counts[t] || 0) + '</button>';
      }).join('');
  }

  function renderMe(el, opts) {
    opts = opts || {};
    var limit = opts.limit || 60;
    var list = filterQuotes(opts.query || '', opts.theme || '');
    var shown = list.slice(0, limit);
    el.libCount.textContent = list.length + ' / ' + global.YM_QUOTES.length;
    el.quoteLib.innerHTML = shown.length ? shown.map(function (q) {
      return '<div class="qlib"><p><span class="th">' + esc(q.theme) + '</span>' + esc(q.text) + '</p>' +
        '<small>' + esc(q.src) + ' · ' + esc(TONE_CN[q.tone] || '') + ' · ' + q.tags.slice(0, 4).map(esc).join(' / ') + '</small></div>';
    }).join('') : '<p class="hint">没有匹配的语录。</p>';
    if (el.btnMore) {
      el.btnMore.hidden = list.length <= limit;
      el.btnMore.textContent = '显示更多（还有 ' + Math.max(list.length - limit, 0) + ' 条）';
    }
    return { total: list.length, shown: shown.length };
  }

  /* ======================= 详情面板 ======================= */
  function renderDetail(x, el) {
    var lines = [];
    lines.push(['事项', esc(x.title)]);
    lines.push(['日期', x.date + ' 周' + WD_CN[S.weekday(x.date)]]);
    lines.push(['时间', x.allDay ? '全天' : (x.start + (x.end ? ' – ' + x.end : ''))]);
    lines.push(['重复', REPEAT_CN[x.repeat] || '不重复']);
    lines.push(['提醒', x.remindOn && x.start ? (x.remindBefore === 0 ? '准时提醒' : '提前 ' + x.remindBefore + ' 分钟') : '未开启']);
    lines.push(['状态', x.done ? '已完成' : (isOverdue(x) ? '已过时未完成' : '待办')]);
    if (x.note) lines.push(['备注', esc(x.note)]);
    if ((x.tags || []).length) lines.push(['标签', x.tags.map(esc).join('、')]);

    var html = '<div>' + lines.map(function (l) {
      return '<div class="detail-line"><b>' + l[0] + '</b><span>' + l[1] + '</span></div>';
    }).join('') + '</div>';
    el.innerHTML = html;
  }

  /* ======================= 标签选择 chips ======================= */
  var PICKABLE = ['工作', '学习', '健康', '休息', '日常', '关系', '人际', '沟通', '金钱', '旅行',
    '复盘', '计划', '目标', '决策', '取舍', '冥想', '专注', '坚持', '习惯', '克制',
    '压力', '情绪', '拖延', '困难', '改变', '成长', '自信', '迷茫'];

  function renderTagChips(el, selected) {
    el.innerHTML = PICKABLE.map(function (t) {
      return '<button class="chip sm' + (selected.indexOf(t) !== -1 ? ' active' : '') + '" data-tag="' + t + '">' + t + '</button>';
    }).join('');
  }

  global.YM_VIEWS = {
    esc: esc, WD_CN: WD_CN, REPEAT_CN: REPEAT_CN, TONE_CN: TONE_CN, PICKABLE: PICKABLE,
    taskHTML: taskHTML, isOverdue: isOverdue, moodLine: moodLine,
    renderToday: renderToday, renderOverdue: renderOverdue, renderCalendar: renderCalendar,
    renderStats: renderStats, renderMe: renderMe, renderLibThemes: renderLibThemes,
    filterQuotes: filterQuotes, renderDetail: renderDetail,
    renderTagChips: renderTagChips, drawTrend: drawTrend
  };
})(window);
