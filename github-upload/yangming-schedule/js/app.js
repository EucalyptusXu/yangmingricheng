/* ============================================================
 * 主控：导航、事件、编辑面板、提醒引擎、原生桥
 * ============================================================ */
(function (global) {
  'use strict';

  var S = global.YM_STORE;
  var V = global.YM_VIEWS;
  var M = global.YM_MATCH;

  var $ = function (id) { return document.getElementById(id); };

  var APP = {
    tab: 'today',
    calScope: 'day',
    anchor: S.today(),
    quoteSalt: 0,
    lastPick: null,
    editingId: null,
    detailInst: null,
    formTags: [],
    formRepeat: 'none',
    libQuery: '',
    libTheme: '',
    libLimit: 60,
    onDataChanged: null
  };
  global.YM_APP = APP;
  /* 暴露给测试/调试（界面不读） */
  APP.collectReminders = function () { return collectReminders(); };

  /* ================= Toast（可带一个撤销动作） ================= */
  var toastTimer = null;
  function toast(msg, actionLabel, actionFn) {
    var t = $('toast');
    if (!t) return;
    t.innerHTML = '<span>' + V.esc(msg) + '</span>' +
      (actionLabel ? '<button class="toast-act" id="toastAct">' + V.esc(actionLabel) + '</button>' : '');
    t.hidden = false;
    if (actionLabel && actionFn) {
      var btn = $('toastAct');
      if (btn) btn.addEventListener('click', function () {
        t.hidden = true;
        actionFn();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 5000 : 1900);
  }

  /* ================= 导航 ================= */
  var VIEWS = { today: 'view-today', calendar: 'view-calendar', stats: 'view-stats', me: 'view-me' };
  var RENDER = { today: renderToday, calendar: renderCalendar, stats: renderStats, me: renderMe };

  function switchTab(tab) {
    APP.tab = tab;
    Object.keys(VIEWS).forEach(function (k) {
      var el = $(VIEWS[k]);
      if (el) el.hidden = (k !== tab);
    });
    var btns = document.querySelectorAll('#tabbar button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset && btns[i].dataset.tab === tab) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
    RENDER[tab]();
    $('fab').hidden = (tab === 'me');
  }

  /* ================= 今日 ================= */
  function renderToday() {
    V.renderToday(S.today(), {
      quoteTheme: $('quoteTheme'), quoteText: $('quoteText'), quoteSrc: $('quoteSrc'),
      quoteReason: $('quoteReason'), btnLike: $('btnLike'),
      ringFg: $('ringFg'), ringPct: $('ringPct'),
      todayTitle: $('todayTitle'), todayMeta: $('todayMeta'), todayMood: $('todayMood'),
      todayList: $('todayList'), todayCount: $('todayCount'), todayEmpty: $('todayEmpty')
    });
    $('brandSub').textContent = APP.lastPick ? APP.lastPick.quote.theme + ' · ' + APP.lastPick.quote.src.replace(/[《》]/g, '') : '知行合一 · 事上磨练';

    renderOverdue();
    renderOnboard();
  }

  function renderOverdue() {
    V.renderOverdue(S.today(), {
      block: $('overdueBlock'), head: $('overdueHead'), list: $('overdueList')
    });
  }

  function renderOnboard() {
    var onboard = S.shouldOnboard();
    $('onboard').hidden = !onboard;
    $('demoBar').hidden = !S.hasDemo();
    if (onboard) { $('overdueBlock').hidden = true; $('todayEmpty').hidden = true; }
  }

  /* ================= 日历 ================= */
  function renderCalendar() {
    var a = APP.anchor, scope = APP.calScope, d = S.parseDate(a), label;
    if (scope === 'day') label = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' + V.WD_CN[S.weekday(a)];
    else if (scope === 'week') { var w = S.weekRange(a); label = w.start.slice(5).replace('-', '/') + ' – ' + w.end.slice(5).replace('-', '/'); }
    else if (scope === 'month') label = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月';
    else label = d.getFullYear() + ' 年';
    $('periodLabel').textContent = label;
    V.renderCalendar(scope, a, $('calBody'));
  }

  function navigate(dir) {
    var a = APP.anchor, scope = APP.calScope, d;
    if (scope === 'day') APP.anchor = S.shift(a, dir);
    else if (scope === 'week') APP.anchor = S.shift(a, 7 * dir);
    else if (scope === 'month') { d = S.parseDate(a); d.setMonth(d.getMonth() + dir); APP.anchor = S.fmt(d); }
    else { d = S.parseDate(a); d.setFullYear(d.getFullYear() + dir); APP.anchor = S.fmt(d); }
    renderCalendar();
  }

  function renderStats() {
    V.renderStats({
      sTotal: $('sTotal'), sDone: $('sDone'), sRate: $('sRate'), sStreak: $('sStreak'),
      trendChart: $('trendChart'), tagBars: $('tagBars'), quoteStatHint: $('quoteStatHint')
    });
  }

  function renderMe() {
    return V.renderMe({
      libCount: $('libCount'), quoteLib: $('quoteLib'), btnMore: $('btnLibMore')
    }, { query: APP.libQuery, theme: APP.libTheme, limit: APP.libLimit });
  }

  function renderLibThemes() {
    V.renderLibThemes($('libTheme'), APP.libTheme);
  }

  /* ================= 编辑面板 ================= */
  function openEdit(inst, presetDate) {
    APP.editingId = inst ? inst.id : null;
    APP.formRepeat = inst ? (inst.repeat || 'none') : 'none';
    APP.formTags = inst ? (inst.tags || []).slice() : [];

    $('editTitle').textContent = inst ? '编辑日程' : '新建日程';
    $('fTitle').value = inst ? inst.title : '';
    $('fNote').value = inst ? inst.note : '';
    $('fDate').value = inst ? inst.date : (presetDate || S.today());
    $('fStart').value = inst ? inst.start : '';
    $('fEnd').value = inst ? inst.end : '';
    $('fRemind').checked = inst ? inst.remindOn !== false : true;
    var adv = String(inst ? inst.remindBefore : S.load().settings.defaultRemindBefore);
    $('fRemindBefore').value = adv === 'undefined' ? '10' : adv;

    var repBtns = $('fRepeat').querySelectorAll('button');
    for (var i = 0; i < repBtns.length; i++) {
      if (repBtns[i].dataset.v === APP.formRepeat) repBtns[i].classList.add('active');
      else repBtns[i].classList.remove('active');
    }
    V.renderTagChips($('fTags'), APP.formTags);
    updateTagPreview();
    $('editMask').hidden = false;
    $('editSheet').hidden = false;
    setTimeout(function () { try { $('fTitle').focus(); } catch (e) {} }, 120);
  }

  function closeEdit() {
    $('editMask').hidden = true;
    $('editSheet').hidden = true;
    APP.editingId = null;
  }

  function updateTagPreview() {
    var title = $('fTitle').value;
    var note = $('fNote').value;
    var date = $('fDate').value || S.today();
    var p = $('tagPreview');
    if (!title.trim()) { p.textContent = '写上事项后，这里会预告首页会变成哪一句。'; return; }

    var peek = M.pick([{
      id: 'tmp', title: title, note: note, tags: APP.formTags,
      done: false, date: date, start: $('fStart').value
    }], date, 0, {});

    var tags = M.extractTags(title, 1);
    var t2 = M.extractTags(note, 0.6);
    var keys = {};
    Object.keys(tags).concat(Object.keys(t2)).forEach(function (k) { keys[k] = 1; });
    APP.formTags.forEach(function (t) { keys[t] = 1; });

    p.innerHTML = peek.coldStart && !Object.keys(keys).length
      ? '这句话里暂时没读出方向，会先给你一句通用的话。<br>预计：<em>' + V.esc(peek.quote.text) + '</em>'
      : '预计首页会变成：<em>' + V.esc(peek.quote.text) + '</em><br><span class="dim">' + V.esc(peek.reason) + '</span>';
  }

  function saveEdit() {
    var title = $('fTitle').value.trim();
    if (!title) { toast('先写点什么吧'); return; }
    var data = {
      title: title, note: $('fNote').value.trim(), date: $('fDate').value || S.today(),
      start: $('fStart').value || '', end: $('fEnd').value || '',
      repeat: APP.formRepeat, remindOn: $('fRemind').checked,
      remindBefore: parseInt($('fRemindBefore').value, 10) || 0,
      tags: APP.formTags
    };
    if (APP.editingId) {
      S.updateItem(APP.editingId, data);
      toast('已更新');
      closeEdit(); refresh();
      return;
    }
    S.addItem(data);
    toast('记下了 · ' + data.date);
    closeEdit();
    if (data.date === S.today()) {
      APP.anchor = data.date;
      switchTab('today');
    } else {
      APP.anchor = data.date;
      APP.calScope = 'day';
      setScopeBtn('day');
      switchTab('calendar');
    }
  }

  /* ================= 详情面板 ================= */
  function openDetail(instId) {
    var parts = instId.split('@');
    var list = S.byDate(parts[1]);
    var inst = null;
    for (var i = 0; i < list.length; i++) if (list[i].instId === instId) inst = list[i];
    if (!inst) return;
    APP.detailInst = inst;
    V.renderDetail(inst, $('detailBody'));
    $('detailMask').hidden = false;
    $('detailSheet').hidden = false;
  }
  function closeDetail() {
    $('detailMask').hidden = true;
    $('detailSheet').hidden = true;
    APP.detailInst = null;
  }

  /* ================= 刷新 & 提醒同步 ================= */
  function refresh() {
    renderToday();
    if (APP.tab === 'calendar') renderCalendar();
    if (APP.tab === 'stats') renderStats();
    if (APP.tab === 'me') renderMe();
    pushReminders();
  }
  APP.onDataChanged = function () {
    setTimeout(function () { if (APP.tab === 'today') renderToday(); }, 0);
  };

  /* ============================================================
   * 提醒引擎
   * ============================================================ */
  function dueNow() {
    var today = S.today();
    var list = S.byDate(today);
    var now = Date.now();
    var out = [];
    list.forEach(function (x) {
      if (x.done || !x.remindOn || !x.start) return;
      var t = new Date(x.date + 'T' + x.start + ':00').getTime() - (x.remindBefore || 0) * 60000;
      if (now >= t && now - t < 90000) {
        var key = x.id + '#' + x.date + '#' + x.remindBefore;
        if (!S.isFired(today, key)) out.push({ inst: x, key: key, at: t });
      }
    });
    return out;
  }

  function beep() {
    if (S.load().settings.sound === false) return;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      var ac = new AC();
      [0, 0.22, 0.44].forEach(function (delay, i) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = i === 2 ? 880 : 660;
        g.gain.value = 0.0001;
        o.connect(g); g.connect(ac.destination);
        var t0 = ac.currentTime + delay;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.start(t0); o.stop(t0 + 0.2);
      });
      setTimeout(function () { try { ac.close(); } catch (e) {} }, 1200);
    } catch (e) { /* 忽略 */ }
  }

  function fireLocal(hit) {
    var x = hit.inst;
    S.markFired(S.today(), hit.key);
    var pick = M.pick([x], x.date, 0, {});
    var text = pick.quote.text;

    if (global.YMBridge && typeof global.YMBridge.notify === 'function') {
      try { global.YMBridge.notify(x.title, text); } catch (e) {}
    } else if (global.Notification && Notification.permission === 'granted') {
      try { new Notification((x.start ? x.start + ' ' : '') + x.title, { body: text, icon: 'assets/mark.svg', tag: hit.key }); } catch (e) {}
    }
    beep();
    if (APP.tab === 'today') renderToday();
    toast('提醒：' + x.title);
  }

  function tick() {
    if (S.load().settings.notify === false) return;
    dueNow().forEach(fireLocal);
  }

  /* 提醒预告期：滚动 30 天。每次打开、每次数据变动都会重算并整体覆盖原生闹钟，
   * 所以只要用户一个月内打开过一次，提醒就不会断 */
  var REMIND_HORIZON_DAYS = 30;
  var REMIND_MAX = 200;

  function collectReminders() {
    var arr = [];
    var start = S.today();
    for (var i = 0; i < REMIND_HORIZON_DAYS; i++) {
      var d = S.shift(start, i);
      S.byDate(d).forEach(function (x) {
        if (arr.length >= REMIND_MAX) return;
        if (!x.remindOn || !x.start) return;
        if (x.repeat === 'none' && x.done) return;
        var t = new Date(x.date + 'T' + x.start + ':00').getTime() - (x.remindBefore || 0) * 60000;
        if (t <= Date.now()) return;
        arr.push({
          id: x.id + '_' + x.date,
          itemId: x.id,
          date: x.date,
          title: x.title,
          time: x.start,
          triggerAt: t,
          /* 已按天展开成一次性实例，原生侧绝不能再按 repeat 重排，
           * 否则每日习惯会在次日重复触发（double-fire）。这里固定 'none'。
           * 重复规则的延续靠「整体替换」：每次打开 App 都重算未来 30 天。 */
          repeat: 'none',
          quote: M.pick([x], x.date, 0, {}).quote.text
        });
      });
    }
    return arr;
  }

  function pushReminders() {
    if (!global.YMBridge || typeof global.YMBridge.setReminders !== 'function') return;
    try {
      var payload = {
        reminders: collectReminders(),
        morning: collectMorningPushes()
      };
      global.YMBridge.setReminders(JSON.stringify(payload));
    } catch (e) { console.warn('同步提醒失败', e); }
  }

  /* 未来 30 天的「早晨推送」排程（每天固定时刻单独一条）。
   * 取那天的日程 → 用同一个匹配引擎挑一句 → 关闭时返回 []. */
  function collectMorningPushes() {
    return S.collectMorningPush(function (items, dateStr) {
      var pick = M.pick(items, dateStr, 0, {});
      if (!pick || !pick.quote) return null;
      return { text: pick.quote.text, src: pick.quote.src };
    });
  }

  function ensurePermission() {
    if (global.YMBridge) {
      try {
        if (typeof global.YMBridge.requestNotificationPermission === 'function') global.YMBridge.requestNotificationPermission();
        if (typeof global.YMBridge.ensureExactAlarm === 'function') global.YMBridge.ensureExactAlarm();
      } catch (e) {}
      return;
    }
    if (global.Notification && Notification.permission === 'default') {
      try {
        Notification.requestPermission().then(function (p) {
          toast(p === 'granted' ? '提醒已开启' : '提醒未授权，仅应用内提醒');
        });
      } catch (e) {
        try { Notification.requestPermission(); } catch (e2) {}
      }
    }
  }

  /* ================= Android 返回键 ================= */
  global.YM_onAndroidBack = function () {
    if (!$('editSheet').hidden) { closeEdit(); return true; }
    if (!$('detailSheet').hidden) { closeDetail(); return true; }
    if (APP.tab !== 'today') { APP.anchor = S.today(); switchTab('today'); return true; }
    return false;
  };

  /* ================= 事件绑定 ================= */
  function bind() {
    $('tabbar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !b.dataset.tab) return;
      switchTab(b.dataset.tab);
    });

    $('btnToday').addEventListener('click', function () {
      APP.anchor = S.today();
      APP.quoteSalt = 0;
      if (APP.tab !== 'today') switchTab('today');
      else renderToday();
      toast('回到今天 · ' + S.today());
    });

    /* ---------- 首次引导 ---------- */
    $('btnOnboardDemo').addEventListener('click', function () {
      S.loadDemo();
      refresh();
      toast('已装入 6 条示例，随便点着看');
    });
    $('btnOnboardStart').addEventListener('click', function () {
      S.load().settings.startedAt = new Date().toISOString();
      S.save();
      refresh();
      openEdit(null, S.today());
    });
    $('btnClearDemo').addEventListener('click', function () {
      var n = S.removeDemo();
      refresh();
      toast('已清空 ' + n + ' 条示例');
    });

    /* ---------- 逾期块 ---------- */
    $('overdueList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.od-act') : null;
      var li = e.target.closest ? e.target.closest('.od-item') : null;
      if (!li) return;
      var id = li.dataset.item, date = li.dataset.date;
      if (!b) { openDetail(id + '@' + date); return; }
      if (b.dataset.act === 'done') {
        S.toggleDone(id, date);
        refresh();
        toast('划掉了');
      } else {
        S.postpone([id], S.today());
        refresh();
        toast('已顺延到今天');
      }
    });

    $('btnPostponeAll').addEventListener('click', function () {
      var list = S.overdueBefore(S.today());
      if (!list.length) return;
      var ids = list.map(function (x) { return x.id; });
      var backup = S.postpone(ids, S.today());
      refresh();
      toast('已把 ' + ids.length + ' 件顺延到今天', '撤销', function () {
        S.undopostpone(backup);
        refresh();
        toast('已恢复');
      });
    });

    /* ---------- 今日列表 ---------- */
    $('todayList').addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.task') : null;
      if (!li) return;
      var id = li.dataset.item, date = li.dataset.date;
      if (e.target.closest('.check')) {
        var nowDone = S.toggleDone(id, date);
        renderToday();
        pushReminders();
        if (nowDone) {
          var st = S.dayStats(date);
          toast(st.done + '/' + st.total + ' · ' + (st.rate >= 1 ? '今天圆满了' : '继续'));
        }
      } else {
        openDetail(li.dataset.inst);
      }
    });

    /* ---------- 语录卡：赞 / 不想听 / 为什么 ---------- */
    $('btnLike').addEventListener('click', function () {
      var p = APP.lastPick;
      if (!p) return;
      var fb = S.addFeedback(S.today(), p.quote.id, 'like');
      renderToday();
      toast(fb.liked.length > 1 ? '记住了，今天不再重复给你' : '好，这句我收着');
    });

    $('btnDislike').addEventListener('click', function () {
      var p = APP.lastPick;
      if (!p) return;
      S.addFeedback(S.today(), p.quote.id, 'dislike');
      APP.quoteSalt = (APP.quoteSalt + 1) % 24;   // 立刻换一句，且今天不再回来
      renderToday();
      toast('换一句');
    });

    $('btnWhy').addEventListener('click', function () {
      if (!APP.lastPick) return;
      toast(APP.lastPick.reason);
    });
    $('quoteReason').addEventListener('click', function () {
      if (!APP.lastPick) return;
      toast(APP.lastPick.reason);
    });

    /* ---------- 日历 ---------- */
    $('scopeSeg').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      setScopeBtn(b.dataset.scope);
      APP.calScope = b.dataset.scope;
      if (APP.calScope === 'year') APP.anchor = S.parseDate(S.today()).getFullYear() + '-01-01';
      else if (APP.calScope === 'month') APP.anchor = S.today().slice(0, 7) + '-01';
      else APP.anchor = S.today();
      renderCalendar();
    });
    $('navPrev').addEventListener('click', function () { navigate(-1); });
    $('navNext').addEventListener('click', function () { navigate(1); });

    $('calBody').addEventListener('click', function (e) {
      var t = e.target;
      var li = t.closest ? t.closest('.task') : null;
      if (li) {
        if (t.closest('.check')) { S.toggleDone(li.dataset.item, li.dataset.date); renderCalendar(); pushReminders(); }
        else openDetail(li.dataset.inst);
        return;
      }
      var cell = t.closest ? t.closest('.daycell') : null;
      if (cell && cell.dataset.date) {
        APP.anchor = cell.dataset.date;
        if (APP.calScope === 'month') { APP.calScope = 'day'; setScopeBtn('day'); }
        renderCalendar();
        return;
      }
      var wcol = t.closest ? t.closest('.wcol') : null;
      if (wcol && wcol.dataset.date) { APP.anchor = wcol.dataset.date; renderCalendar(); return; }
      var heat = t.closest ? t.closest('i[data-date]') : null;
      if (heat && heat.dataset.date) { APP.anchor = heat.dataset.date; APP.calScope = 'day'; setScopeBtn('day'); renderCalendar(); return; }
      var dtitle = t.closest ? t.closest('.day-list-title') : null;
      if (dtitle && dtitle.dataset.date) { APP.anchor = dtitle.dataset.date; renderCalendar(); }
    });

    /* ---------- 添加 ---------- */
    $('fab').addEventListener('click', function () {
      openEdit(null, APP.tab === 'calendar' ? APP.anchor : S.today());
    });

    /* ---------- 编辑面板 ---------- */
    $('editCancel').addEventListener('click', closeEdit);
    $('editMask').addEventListener('click', closeEdit);
    $('editSave').addEventListener('click', saveEdit);
    $('fRepeat').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var btns = $('fRepeat').querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      b.classList.add('active');
      APP.formRepeat = b.dataset.v;
    });
    $('fTags').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !b.dataset.tag) return;
      var t = b.dataset.tag, i = APP.formTags.indexOf(t);
      if (i === -1) { APP.formTags.push(t); b.classList.add('active'); }
      else { APP.formTags.splice(i, 1); b.classList.remove('active'); }
      updateTagPreview();
    });
    $('fTitle').addEventListener('input', updateTagPreview);
    $('fNote').addEventListener('input', updateTagPreview);
    $('fDate').addEventListener('change', updateTagPreview);
    $('fStart').addEventListener('change', updateTagPreview);

    /* ---------- 详情面板 ---------- */
    $('detailClose').addEventListener('click', closeDetail);
    $('detailMask').addEventListener('click', closeDetail);
    $('detailEdit').addEventListener('click', function () {
      var inst = APP.detailInst;
      if (!inst) return;
      closeDetail();
      openEdit(inst.item);
    });
    $('detailDelete').addEventListener('click', function () {
      var inst = APP.detailInst;
      if (!inst) return;
      var backup = S.removeItem(inst.id);
      closeDetail();
      refresh();
      toast('已删除', '撤销', function () {
        S.restoreItem(backup);
        refresh();
        toast('已恢复');
      });
    });

    /* ---------- 我的 ---------- */
    $('libSearch').addEventListener('input', function () {
      APP.libQuery = this.value;
      APP.libLimit = 60;
      renderMe();
    });
    $('libTheme').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      APP.libTheme = b.dataset.theme || '';
      APP.libLimit = 60;
      renderLibThemes();
      renderMe();
    });
    $('btnLibMore').addEventListener('click', function () {
      APP.libLimit += 120;
      renderMe();
    });

    $('btnAskPerm').addEventListener('click', function () { ensurePermission(); toast('已请求通知权限'); });
    $('btnTestNotify').addEventListener('click', function () {
      var pick = M.pick(S.byDate(S.today()), S.today(), 0, {});
      var body = pick.quote.text;
      if (global.YMBridge && typeof global.YMBridge.notify === 'function') {
        try { global.YMBridge.notify('阳明日程 · 提醒测试', body); } catch (e) {}
        toast('已发送，看看通知栏');
      } else if (global.Notification && Notification.permission === 'granted') {
        try { new Notification('阳明日程 · 提醒测试', { body: body, icon: 'assets/mark.svg' }); } catch (e) {}
        toast('已发送，看看通知栏');
      } else {
        toast('当前环境不支持系统通知，改为页面内提示');
        try { global.alert('阳明日程 · 提醒测试\n\n' + body); } catch (e) {}
      }
      beep();
    });

    $('setNotify').addEventListener('change', function () {
      S.load().settings.notify = this.checked; S.save();
      if (this.checked) ensurePermission();
      toast(this.checked ? '提醒已开启' : '提醒已关闭');
    });
    $('setSound').addEventListener('change', function () {
      S.load().settings.sound = this.checked; S.save();
    });
    $('setShowReason').addEventListener('change', function () {
      S.load().settings.showReason = this.checked; S.save();
      if (APP.tab === 'today') renderToday();
    });
    $('setAdvance').addEventListener('change', function () {
      S.load().settings.defaultRemindBefore = parseInt(this.value, 10) || 0; S.save();
      toast('默认提前 ' + this.value + ' 分钟');
    });
    $('setMorningPush').addEventListener('change', function () {
      S.load().settings.morningPush = this.checked; S.save();
      $('setMorningTime').disabled = !this.checked;
      pushReminders();
      toast(this.checked ? '早晨推送已开启' : '早晨推送已关闭');
    });
    $('setMorningTime').addEventListener('change', function () {
      var v = this.value || '07:30';
      S.load().settings.morningPushTime = v; S.save();
      pushReminders();
      toast('推送时间改为 ' + v);
    });

    $('btnExport').addEventListener('click', function () {
      var box = $('ioBox');
      box.hidden = false;
      box.value = S.exportJSON();
      try { box.select(); } catch (e) {}
      toast('已生成备份，可复制保存');
    });
    $('btnImport').addEventListener('click', function () {
      var box = $('ioBox');
      if (box.hidden || !box.value.trim()) { box.hidden = false; box.value = ''; toast('先粘贴备份内容'); return; }
      try {
        var n = S.importJSON(box.value, 'merge');
        box.hidden = true; box.value = '';
        refresh(); renderMe();
        toast('导入成功，共 ' + n + ' 条');
      } catch (e) { toast('导入失败：' + e.message); }
    });
    $('btnClear').addEventListener('click', function () {
      if (global.confirm && !global.confirm('确定清空全部日程？此操作不可撤销。')) return;
      S.clearAll();
      APP.anchor = S.today();
      refresh();
      toast('已清空');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeEdit(); closeDetail(); }
    });
  }

  function setScopeBtn(scope) {
    var btns = $('scopeSeg').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.scope === scope) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
  }

  /* ================= 启动 ================= */
  function boot() {
    S.load();

    var st = S.load().settings;
    $('setNotify').checked = st.notify !== false;
    $('setSound').checked = st.sound !== false;
    $('setShowReason').checked = st.showReason !== false;
    $('setAdvance').value = String(st.defaultRemindBefore);
    $('setMorningPush').checked = st.morningPush !== false;
    $('setMorningTime').value = /^([01]\d|2[0-3]):[0-5]\d$/.test(st.morningPushTime || '') ? st.morningPushTime : '07:30';
    $('setMorningTime').disabled = $('setMorningPush').checked === false;

    $('fDate').value = S.today();
    V.renderTagChips($('fTags'), []);

    bind();
    switchTab('today');
    renderLibThemes();
    renderMe();

    tick();
    setInterval(tick, 20000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { refresh(); tick(); }
    });

    if (st.notify !== false) setTimeout(ensurePermission, 1200);

    global.YM_nativeRefresh = function () { APP.anchor = S.today(); refresh(); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
