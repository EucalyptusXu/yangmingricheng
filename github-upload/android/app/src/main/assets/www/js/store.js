/* ============================================================
 * 数据层：全部落在 localStorage，离线可用，不联网
 * 一条日程 = 一个 item；重复日程用 doneLog 记录每天是否完成
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'ym_schedule_v1';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return fmt(new Date()); }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shift(dateStr, n) { var d = parseDate(dateStr); d.setDate(d.getDate() + n); return fmt(d); }
  function weekday(dateStr) { return parseDate(dateStr).getDay(); }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var DEFAULTS = {
    version: 2,
    items: [],
    settings: {
      notify: true,
      sound: true,
      showReason: true,
      defaultRemindBefore: 10,
      startedAt: null,
      demoLoaded: false
    },
    feedback: {},
    fired: {}
  };

  var state = null;

  /* ---------------- 持久化 ---------------- */
  function load() {
    if (state) return state;
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : null;
    } catch (e) { state = null; }
    if (!state || typeof state !== 'object') state = JSON.parse(JSON.stringify(DEFAULTS));
    if (!state.items) state.items = [];
    if (!state.settings) state.settings = {};
    if (!state.feedback) state.feedback = {};
    if (!state.fired) state.fired = {};
    for (var k in DEFAULTS.settings) {
      if (state.settings[k] === undefined) state.settings[k] = DEFAULTS.settings[k];
    }
    return state;
  }

  function save() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('保存失败', e); }
    if (global.YM_APP && global.YM_APP.onDataChanged) global.YM_APP.onDataChanged();
  }

  /* ---------------- 重复规则 ---------------- */
  function occursOn(item, dateStr) {
    if (!item.repeat || item.repeat === 'none') return item.date === dateStr;
    if (dateStr < item.date) return false;
    if (item.until && dateStr > item.until) return false;
    var wd = weekday(dateStr);
    switch (item.repeat) {
      case 'daily': return true;
      case 'weekday': return wd >= 1 && wd <= 5;
      case 'weekly': return wd === weekday(item.date);
      case 'monthly': return parseDate(dateStr).getDate() === parseDate(item.date).getDate();
      default: return false;
    }
  }

  function doneOf(item, dateStr) {
    if (!item.repeat || item.repeat === 'none') return !!item.done;
    return (item.doneLog || []).indexOf(dateStr) !== -1;
  }

  function setDone(item, dateStr, val) {
    if (!item.repeat || item.repeat === 'none') {
      item.done = !!val;
      item.doneAt = val ? new Date().toISOString() : null;
    } else {
      item.doneLog = item.doneLog || [];
      var i = item.doneLog.indexOf(dateStr);
      if (val && i === -1) item.doneLog.push(dateStr);
      if (!val && i !== -1) item.doneLog.splice(i, 1);
    }
  }

  /* ---------------- 查询 ---------------- */
  function instOf(item, dateStr) {
    return {
      item: item,
      id: item.id,
      instId: item.id + '@' + dateStr,
      date: dateStr,
      title: item.title,
      note: item.note || '',
      start: item.start || '',
      end: item.end || '',
      tags: item.tags || [],
      repeat: item.repeat || 'none',
      remindOn: item.remindOn !== false,
      remindBefore: item.remindBefore === undefined ? load().settings.defaultRemindBefore : item.remindBefore,
      done: doneOf(item, dateStr),
      demo: !!item.demo,
      allDay: !item.start
    };
  }

  function byDate(dateStr) {
    var s = load();
    var out = [];
    s.items.forEach(function (it) {
      if (occursOn(it, dateStr)) out.push(instOf(it, dateStr));
    });
    out.sort(function (a, b) {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.allDay && b.allDay) return a.title.localeCompare(b.title);
      return a.start.localeCompare(b.start);
    });
    return out;
  }

  function getItem(id) {
    var s = load();
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) return s.items[i];
    return null;
  }
  function allItems() { return load().items.slice(); }

  /**
   * 逾期：过去没划掉的事。
   * 只统计「不重复」的日程 —— 每天的习惯昨天没做不算欠债，今天照做就是。
   */
  function overdueBefore(dateStr, lookbackDays) {
    var s = load();
    var days = lookbackDays || 60;
    var from = shift(dateStr, -days);
    var out = [];
    s.items.forEach(function (it) {
      if (it.repeat && it.repeat !== 'none') return;
      if (it.done) return;
      if (it.date >= dateStr || it.date < from) return;
      out.push(instOf(it, it.date));
    });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.start || '').localeCompare(b.start || '');
    });
    return out;
  }

  /* ---------------- 增删改 ---------------- */
  function touchStarted() {
    var s = load();
    if (!s.settings.startedAt) { s.settings.startedAt = new Date().toISOString(); save(); }
  }

  function addItem(data) {
    var s = load();
    var it = {
      id: uid(),
      title: (data.title || '').trim() || '未命名事项',
      note: data.note || '',
      date: data.date || today(),
      start: data.start || '',
      end: data.end || '',
      tags: data.tags || [],
      repeat: data.repeat || 'none',
      until: data.until || null,
      remindOn: data.remindOn !== false,
      remindBefore: data.remindBefore === undefined ? s.settings.defaultRemindBefore : data.remindBefore,
      done: false,
      doneAt: null,
      doneLog: [],
      demo: !!data.demo,
      createdAt: new Date().toISOString()
    };
    s.items.push(it);
    s.settings.startedAt = s.settings.startedAt || new Date().toISOString();
    save();
    return it;
  }

  function updateItem(id, patch) {
    var it = getItem(id);
    if (!it) return null;
    for (var k in patch) if (patch.hasOwnProperty.call(patch, k)) it[k] = patch[k];
    save();
    return it;
  }

  function removeItem(id) {
    var s = load();
    var idx = -1;
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) idx = i;
    if (idx === -1) return null;
    var backup = s.items[idx];
    s.items.splice(idx, 1);
    save();
    return backup;
  }

  function restoreItem(item) {
    if (!item) return;
    load().items.push(item);
    save();
  }

  /** 批量顺延：把逾期事项改到目标日期，返回被改动的备份，便于撤销 */
  function postpone(ids, toDate) {
    var s = load();
    var backup = [];
    s.items.forEach(function (it) {
      if (ids.indexOf(it.id) === -1) return;
      backup.push({ id: it.id, date: it.date });
      it.date = toDate;
      it.postponedFrom = it.postponedFrom || [];
      it.postponedFrom.push(backup[backup.length - 1].date);
    });
    save();
    return backup;
  }

  function undopostpone(backup) {
    (backup || []).forEach(function (b) {
      var it = getItem(b.id);
      if (it) it.date = b.date;
    });
    save();
  }

  function toggleDone(id, dateStr) {
    var it = getItem(id);
    if (!it) return false;
    var next = !doneOf(it, dateStr);
    setDone(it, dateStr, next);
    save();
    return next;
  }

  /* ---------------- 示例数据 ---------------- */
  function hasDemo() {
    return load().items.some(function (i) { return i.demo; });
  }

  /** 显式加载示例（首次运行的引导里点"试用示例"才调用，不再自动塞） */
  function loadDemo() {
    var s = load();
    removeDemo();
    var t = today();
    var demo = [
      { title:'产品需求评审会', note:'要跟开发对齐排期，可能被砍功能', date:t, start:'10:00', end:'11:00', tags:['工作'] },
      { title:'跑步 5 公里', note:'上周停了三天，今天补上', date:t, start:'19:30', end:'20:10', tags:['健康'] },
      { title:'写周报，复盘这一周', note:'', date:t, start:'21:00', end:'21:40', tags:['复盘'] },
      { title:'读《传习录》二十分钟', note:'上卷·徐爱录', date:t, start:'', end:'', tags:['学习'], repeat:'daily' },
      { title:'背单词', note:'', date:shift(t, -1), start:'08:00', end:'08:30', tags:['学习'] },
      { title:'和家里通个电话', note:'', date:shift(t, 1), start:'20:00', end:'20:30', tags:['关系'] }
    ];
    demo.forEach(function (d) { addItem(Object.assign({ demo: true }, d)); });
    s = load();
    var first = s.items.filter(function (i) { return i.demo; });
    if (first[0]) { first[0].done = true; first[0].doneAt = new Date().toISOString(); }
    if (first[1]) { first[1].done = true; first[1].doneAt = new Date().toISOString(); }
    if (first[4]) { first[4].done = true; first[4].doneAt = new Date().toISOString(); }
    s.settings.demoLoaded = true;
    save();
    return first.length;
  }

  /** 一键清空示例，不动用户自己加的数据 */
  function removeDemo() {
    var s = load();
    var before = s.items.length;
    s.items = s.items.filter(function (i) { return !i.demo; });
    s.settings.demoLoaded = false;
    save();
    return before - s.items.length;
  }

  /** 首次运行引导是否该出现 */
  function shouldOnboard() {
    var s = load();
    return !s.settings.startedAt && s.items.length === 0;
  }

  /* ---------------- 统计 ---------------- */
  function dayStats(dateStr) {
    var list = byDate(dateStr);
    var done = list.filter(function (x) { return x.done; }).length;
    return { date: dateStr, total: list.length, done: done, rate: list.length ? done / list.length : 0, list: list };
  }

  function weekRange(dateStr) {
    var wd = weekday(dateStr);
    var offset = wd === 0 ? -6 : 1 - wd;
    var start = shift(dateStr, offset);
    return { start: start, end: shift(start, 6) };
  }

  function weekStats(dateStr) {
    var r = weekRange(dateStr);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(dayStats(shift(r.start, i)));
    return { start: r.start, end: r.end, days: days };
  }

  function monthStats(y, m) {
    var last = new Date(y, m + 1, 0);
    var days = [];
    for (var d = 1; d <= last.getDate(); d++) days.push(dayStats(fmt(new Date(y, m, d))));
    var total = days.reduce(function (a, x) { return a + x.total; }, 0);
    var done = days.reduce(function (a, x) { return a + x.done; }, 0);
    return { year: y, month: m, days: days, total: total, done: done, rate: total ? done / total : 0 };
  }

  function yearStats(y) {
    var months = [];
    for (var m = 0; m < 12; m++) months.push(monthStats(y, m));
    var total = months.reduce(function (a, x) { return a + x.total; }, 0);
    var done = months.reduce(function (a, x) { return a + x.done; }, 0);
    var jan1 = new Date(y, 0, 1);
    var wd = jan1.getDay();
    var start = new Date(y, 0, 1 - (wd === 0 ? 6 : wd - 1));
    var cells = [];
    for (var i = 0; i < 371; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var ds = fmt(d);
      cells.push(d.getFullYear() === y
        ? { date: ds, stat: dayStats(ds) }
        : { date: ds, out: true, stat: null });
    }
    return { year: y, months: months, cells: cells, total: total, done: done, rate: total ? done / total : 0 };
  }

  function tagDistribution(startStr, endStr) {
    var bag = {};
    var d = startStr, guard = 0;
    while (d <= endStr && guard++ < 400) {
      byDate(d).forEach(function (x) {
        var t = global.YM_MATCH.extractTags(x.title, 1);
        var t2 = global.YM_MATCH.extractTags(x.note, 0.6);
        (x.tags || []).forEach(function (tg) { t[tg] = (t[tg] || 0) + 1.2; });
        [t, t2].forEach(function (b) {
          for (var k in b) if (b.hasOwnProperty.call(b, k)) bag[k] = (bag[k] || 0) + b[k];
        });
      });
      d = shift(d, 1);
    }
    var arr = [];
    for (var k in bag) if (bag.hasOwnProperty.call(bag, k)) arr.push({ tag: k, n: bag[k] });
    arr.sort(function (a, b) { return b.n - a.n; });
    return arr;
  }

  /* ---------------- 语录反馈（👍/👎） ---------------- */
  function feedbackFor(dateStr) {
    var s = load();
    var f = s.feedback[dateStr] || {};
    return { liked: f.liked || [], disliked: f.disliked || [] };
  }

  function addFeedback(dateStr, quoteId, type) {
    var s = load();
    if (!s.feedback[dateStr]) s.feedback[dateStr] = { liked: [], disliked: [] };
    var day = s.feedback[dateStr];
    if (!day.liked) day.liked = [];
    if (!day.disliked) day.disliked = [];
    // 互斥：点过赞就不再算不想听，反之亦然
    var to = type === 'like' ? day.liked : day.disliked;
    var from = type === 'like' ? day.disliked : day.liked;
    if (to.indexOf(quoteId) === -1) to.push(quoteId);
    var i = from.indexOf(quoteId);
    if (i !== -1) from.splice(i, 1);
    // 只留最近 30 天
    var keys = Object.keys(s.feedback).sort();
    while (keys.length > 30) { delete s.feedback[keys.shift()]; }
    save();
    return { liked: day.liked.slice(), disliked: day.disliked.slice() };
  }

  /* ---------------- 提醒去重 ---------------- */
  function isFired(dateStr, key) {
    var s = load();
    return !!(s.fired[dateStr] && s.fired[dateStr].indexOf(key) !== -1);
  }
  function markFired(dateStr, key) {
    var s = load();
    if (!s.fired[dateStr]) s.fired[dateStr] = [];
    if (s.fired[dateStr].indexOf(key) === -1) s.fired[dateStr].push(key);
    var keys = Object.keys(s.fired).sort();
    while (keys.length > 14) { delete s.fired[keys.shift()]; }
    save();
  }

  /* ---------------- 导入导出 ---------------- */
  function exportJSON() { return JSON.stringify(load(), null, 2); }
  function importJSON(txt, mode) {
    var data = JSON.parse(txt);
    if (!data || !Array.isArray(data.items)) throw new Error('格式不对');
    var s = load();
    if (mode === 'replace') {
      s.items = data.items;
      if (data.settings) s.settings = Object.assign({}, DEFAULTS.settings, data.settings);
      s.feedback = data.feedback || {};
    } else {
      var exist = {};
      s.items.forEach(function (i) { exist[i.id] = 1; });
      data.items.forEach(function (i) { if (!exist[i.id]) s.items.push(i); });
      for (var d in (data.feedback || {})) {
        if (!s.feedback[d]) s.feedback[d] = data.feedback[d];
      }
    }
    save();
    return s.items.length;
  }

  function clearAll() {
    state = JSON.parse(JSON.stringify(DEFAULTS));
    state.settings.startedAt = new Date().toISOString();
    save();
  }

  global.YM_STORE = {
    load: load, save: save,
    fmt: fmt, today: today, parseDate: parseDate, shift: shift, weekday: weekday, uid: uid,
    byDate: byDate, getItem: getItem, allItems: allItems, instOf: instOf,
    overdueBefore: overdueBefore,
    addItem: addItem, updateItem: updateItem, removeItem: removeItem, restoreItem: restoreItem,
    postpone: postpone, undopostpone: undopostpone,
    toggleDone: toggleDone, doneOf: doneOf,
    dayStats: dayStats, weekStats: weekStats, weekRange: weekRange,
    monthStats: monthStats, yearStats: yearStats, tagDistribution: tagDistribution,
    hasDemo: hasDemo, loadDemo: loadDemo, removeDemo: removeDemo, shouldOnboard: shouldOnboard,
    feedbackFor: feedbackFor, addFeedback: addFeedback,
    isFired: isFired, markFired: markFired,
    exportJSON: exportJSON, importJSON: importJSON, clearAll: clearAll
  };
})(window);
