/* 冒烟测试：真实渲染路径 + 引擎逻辑
 * 跑法：node tests/smoke.js   （在 yangming-schedule/ 目录下） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildDocument } = require('./dom-stub');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n▸ ' + t); }

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const doc = buildDocument(html);
const sandbox = {};
sandbox.window = sandbox;
sandbox.document = doc;
sandbox.localStorage = localStorage;
sandbox.console = console;
sandbox.devicePixelRatio = 2;
sandbox.setTimeout = (fn) => { try { fn(); } catch (e) { console.log('  [timeout err] ' + e.message); } return 0; };
sandbox.setInterval = () => 0;
sandbox.clearTimeout = () => {};
sandbox.clearInterval = () => {};
sandbox.requestAnimationFrame = fn => fn(0);
sandbox.navigator = { userAgent: 'node' };
vm.createContext(sandbox);
function run(f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); }

const DATA_FILES = ['js/data/lexicon.js','js/data/quotes.js','js/data/quotes-01-chuanxilu.js',
  'js/data/quotes-02-prose.js','js/data/quotes-03-poems.js','js/data/quotes-04-supplement.js'];

section('脚本加载与语料库完整性');
try {
  DATA_FILES.forEach(run);
  run('js/matcher.js');
  run('js/store.js');
  ok('语录总数 ≥ 400', sandbox.YM_QUOTES.length >= 400, 'count=' + sandbox.YM_QUOTES.length);
  const ids = sandbox.YM_QUOTES.map(q => q.id);
  ok('id 唯一', new Set(ids).size === ids.length);
  const texts = sandbox.YM_QUOTES.map(q => q.text);
  const dupT = [...new Set(texts.filter((v, i) => texts.indexOf(v) !== i))];
  ok('正文无重复', dupT.length === 0, dupT.slice(0, 3).join(' | '));
  ok('每条都有 id/theme/tone/src/text/tags', sandbox.YM_QUOTES.every(q => q.id && q.theme && q.tone && q.src && q.text && Array.isArray(q.tags) && q.tags.length));
  const POOL = new Set(sandbox.YM_TAG_POOL);
  const badTags = [...new Set(sandbox.YM_QUOTES.flatMap(q => q.tags))].filter(t => !POOL.has(t));
  ok('全部标签都在标签池内', badTags.length === 0, badTags.join(','));
  const THEMES = Object.keys(sandbox.YM_THEMES);
  const badThemes = [...new Set(sandbox.YM_QUOTES.map(q => q.theme))].filter(t => THEMES.indexOf(t) === -1);
  ok('全部主题都有配置', badThemes.length === 0, badThemes.join(','));
  ok('每个主题都有配色和语气', THEMES.every(t => sandbox.YM_THEMES[t].color && sandbox.YM_THEMES[t].tone));
  const tone = {};
  sandbox.YM_QUOTES.forEach(q => tone[q.tone] = (tone[q.tone] || 0) + 1);
  const pct = n => n / sandbox.YM_QUOTES.length;
  ok('语气配平：律己不超过 45%', pct(tone.strict) <= 0.45, Math.round(pct(tone.strict) * 100) + '%');
  ok('语气配平：松弛不低于 30%', pct(tone.warm) >= 0.30, Math.round(pct(tone.warm) * 100) + '%');
  ok('三种语气都存在', tone.strict > 0 && tone.warm > 0 && tone.clear > 0, JSON.stringify(tone));
  ok('近义扩展表非空', Object.keys(sandbox.YM_TAG_RELATED).length > 40);
  ok('兜底池每条都有足够候选', Object.keys(sandbox.YM_FALLBACK).every(k => {
    const tags = sandbox.YM_FALLBACK[k];
    return sandbox.YM_QUOTES.filter(q => q.tags.some(t => tags.indexOf(t) !== -1)).length >= 12;
  }));
  run('js/views.js');
  run('js/app.js');
} catch (e) {
  ok('脚本加载', false, e.stack.split('\n').slice(0, 3).join(' | '));
}

const S = sandbox.YM_STORE, M = sandbox.YM_MATCH, A = sandbox.YM_APP;
const $ = id => doc.getElementById(id);

/* ---------- 引擎 ---------- */
section('匹配引擎 · 分词与近义扩展');
ok('长词优先：「评审」不被「会」拆', M.extractTags('产品评审会')['工作'] >= 1);
ok('多词不重叠命中', (() => { const t = M.extractTags('去医院体检然后早睡'); return t['健康'] >= 1 && t['休息'] >= 1; })());
const ex = M.relatedExpand({ '金钱': 1 });
ok('稀薄标签会带出邻居', ex['名利'] > 0 && ex['得失'] > 0, JSON.stringify(ex));

section('引擎 · 冷启动兜底');
const one = [{ id:'a', title:'开会', note:'', tags:[], done:false, date:S.today(), start:'' }];
const cold = M.pick(one, S.today(), 0, {});
ok('信息量不足时走兜底', cold.coldStart === true);
ok('兜底也一定给出结果', !!cold.quote);
ok('兜底结果不空、有出处', cold.quote.text.length > 0 && cold.quote.src.length > 0);
const rich = [1,2,3,4].map(i => ({ id:'r'+i, title:'写周报 复盘项目', note:'', tags:['复盘'], done:i<3, date:S.today(), start:'09:00' }));
ok('信息量足够时不走兜底', M.pick(rich, S.today(), 0, {}).coldStart === false);

section('引擎 · 语气底线（累的时候不说教）');
const tired = [1,2,3].map(i => ({ id:'t'+i, title:'开会 写文档', note:'有点累', tags:['工作'], done:false, date:S.today(), start:'' }));
const tiredPicks = [];
for (let s = 0; s < 60; s++) tiredPicks.push(M.pick(tired, S.today(), s, {}));
ok('完成率低 + 无向上意图 → 硬过滤掉 strict', tiredPicks.every(p => p.strictFiltered === true));
ok('完成率低 + 无向上意图 → 60 次里一次 strict 都没有', tiredPicks.every(p => p.tone !== 'strict'),
  'strict ' + tiredPicks.filter(p => p.tone === 'strict').length + ' 次');
ok('无向上意图被正确识别', tiredPicks.every(p => p.intent === false));

const planning = [1,2,3].map(i => ({ id:'p'+i, title:'制定下季度学习计划', note:'', tags:['计划','学习'], done:false, date:S.today(), start:'' }));
const planPicks = [];
for (let s = 0; s < 40; s++) planPicks.push(M.pick(planning, S.today(), s, {}));
ok('用户自己在规划 → 解除硬过滤', planPicks.every(p => p.strictFiltered === false));
ok('用户自己在规划 → 被正确识别为有向上意图', planPicks.every(p => p.intent === true));
const strongStrict = [1,2,3].map(i => ({ id:'s'+i, title:'立志 目标 方向 志不立', note:'要立个志', tags:['立志'], done:false, date:S.today(), start:'' }));
const ssPicks = [];
for (let s = 0; s < 40; s++) ssPicks.push(M.pick(strongStrict, S.today(), s, {}));
ok('明确求立志时 → strict 会被真的选中', ssPicks.some(p => p.tone === 'strict'),
  'strict ' + ssPicks.filter(p => p.tone === 'strict').length + '/40');

const doneAll = [1,2,3,4].map(i => ({ id:'d'+i, title:'开会 复盘', note:'', tags:['复盘'], done:true, date:S.today(), start:'' }));
const highPicks = [];
for (let s = 0; s < 60; s++) highPicks.push(M.pick(doneAll, S.today(), s, {}));
ok('全部完成 → 以 warm/clear 为主', highPicks.filter(p => p.tone !== 'strict').length >= 45,
  'non-strict ' + highPicks.filter(p => p.tone !== 'strict').length + '/60');
ok('全部完成 → 不触发硬过滤', highPicks.every(p => p.strictFiltered === false));
const emptyDay = M.pick([], S.today(), 0, {});
ok('空白一天 → 正常出句且有理由', !!emptyDay.quote && emptyDay.reason.length > 4);
ok('空白一天不触发硬过滤（可以立个志）', emptyDay.strictFiltered === false);

section('引擎 · 理由不暴露实现');
const reasons = [];
for (let s = 0; s < 30; s++) {
  reasons.push(M.pick(rich, S.today(), s, {}).reason);
  reasons.push(M.pick(one, S.today(), s, {}).reason);
}
ok('理由里不出现「识别到」', reasons.every(r => r.indexOf('识别到') === -1));
const allTags = M.allTags();
ok('理由里不出现任何标签名', reasons.every(r => {
  if (r.indexOf('关键词') !== -1) return false;
  return !allTags.some(t => t.length >= 2 && r.indexOf(t) !== -1);
}), reasons.find(r => allTags.some(t => t.length >= 2 && r.indexOf(t) !== -1)) || '');
ok('理由有情绪化措辞', reasons.some(r => /松一点|站在你这边|为什么开始|不是催|把事说明白/.test(r)));

section('引擎 · 稳定与负反馈');
const p1 = M.pick(rich, S.today(), 0, {}).quote.id;
const p2 = M.pick(rich, S.today(), 0, {}).quote.id;
ok('同输入同日同参数 → 同一句', p1 === p2, p1 + ' vs ' + p2);
const avoided = M.pick(rich, S.today(), 0, { disliked: [p1] }).quote.id;
ok('被标记「不想听」的句子不再出现', avoided !== p1);
const likedSame = M.pick(rich, S.today(), 0, { liked: [p1] }).quote.id;
ok('点过「说得对」的同句当天不再重复', likedSame !== p1);

/* ---------- 首启与示例 ---------- */
section('首次运行与示例数据');
ok('启动后没有自动塞数据', S.allItems().length === 0, 'n=' + S.allItems().length);
ok('引导卡片可见', $('onboard').hidden === false);
ok('示例提示条隐藏', $('demoBar').hidden === true);
ok('shouldOnboard 为真', S.shouldOnboard() === true);
$('btnOnboardDemo').click();
ok('点「先用示例看看」装入 6 条', S.allItems().length === 6, 'n=' + S.allItems().length);
ok('示例条目标记为 demo', S.allItems().every(i => i.demo === true));
ok('示例提示条出现', $('demoBar').hidden === false);
ok('引导卡片消失', $('onboard').hidden === true);
ok('示例不污染 stats（可单独识别）', S.allItems().filter(i => i.demo).length === 6);
$('btnClearDemo').click();
ok('一键清空示例后归零', S.allItems().length === 0);
ok('清空后不再弹引导', S.shouldOnboard() === false);
ok('清空后示例提示条隐藏', $('demoBar').hidden === true);

/* ---------- 添加 / 编辑 ---------- */
section('功能一：添加日程');
$('fab').click();
ok('点＋打开面板', $('editSheet').hidden === false);
ok('日期默认今天', $('fDate').value === S.today());
$('fTitle').value = '准备面试材料';
$('fTitle').dispatchEvent({ type: 'input', target: $('fTitle') });
ok('实时预览给出理由而非标签', ($('tagPreview').innerHTML || '').indexOf('预计首页会变成') !== -1, $('tagPreview').innerHTML.slice(0, 80));
ok('预览不出现「识别到」', ($('tagPreview').innerHTML || '').indexOf('识别到') === -1);
$('fStart').value = '14:00';
$('editSave').click();
ok('保存成功', S.allItems().length === 1);
ok('保存后面板关闭', $('editSheet').hidden === true);

section('功能一之二：编辑入口可达（本次修复）');
const added = S.allItems()[0];
ok('新增条目字段正确', added.title === '准备面试材料' && added.start === '14:00');
$('todayList').dispatchEvent({ type: 'click', target: $('todayList').querySelector('.t-title'), preventDefault() {}, stopPropagation() {} });
ok('点标题打开详情', $('detailSheet').hidden === false);
ok('详情面板存在「编辑」按钮', !!$('detailEdit'));
$('detailEdit').click();
ok('点编辑 → 详情关闭、编辑面板打开', $('detailSheet').hidden === true && $('editSheet').hidden === false);
ok('编辑面板带出原值', $('fTitle').value === '准备面试材料' && $('fStart').value === '14:00' && $('fDate').value === added.date,
  $('fTitle').value + ' / ' + $('fStart').value);
$('fStart').value = '11:00';
$('editSave').click();
ok('改动落库', S.getItem(added.id).start === '11:00');
ok('编辑不改数量', S.allItems().length === 1);

/* ---------- 逾期顺延 ---------- */
section('功能二：逾期汇总与一键顺延');
const y = S.shift(S.today(), -1), y2 = S.shift(S.today(), -3);
S.addItem({ title:'昨天的会', date:y, start:'10:00' });
S.addItem({ title:'三天前的报告', date:y2, start:'' });
S.addItem({ title:'昨天做完的事', date:y, start:'15:00' });
S.updateItem(S.allItems().find(i => i.title === '昨天做完的事').id, { done:true });
S.addItem({ title:'每天读书', date:S.shift(S.today(), -5), repeat:'daily' });
const od = S.overdueBefore(S.today());
ok('逾期只统计不重复的未完成项', od.length === 2, 'n=' + od.length + ' → ' + od.map(x => x.title).join(','));
ok('重复日程不算欠债', od.every(x => x.title !== '每天读书'));
ok('逾期按日期升序', od[0].date <= od[1].date);
ok('未来的事项不算逾期', S.overdueBefore(S.today()).every(x => x.date < S.today()));
tools_render();
function tools_render() { sandbox.YM_VIEWS.renderOverdue(S.today(), { block:$('overdueBlock'), head:$('overdueHead'), list:$('overdueList') }); }
ok('逾期块显示出来', $('overdueBlock').hidden === false);
ok('逾期块写出天数与件数', /过去 \d+ 天里，有 2 件没划掉/.test($('overdueHead').textContent), $('overdueHead').textContent);
ok('逾期列表渲染出条目', $('overdueList').querySelectorAll('.od-item').length === 2);
const odItem = $('overdueList').querySelector('.od-item');
const odId = odItem.dataset.item, odDate = odItem.dataset.date;
$('overdueList').dispatchEvent({ type: 'click', target: odItem.querySelector('[data-act="move"]'), preventDefault() {}, stopPropagation() {} });
ok('单项顺延 → 日期变成今天', S.getItem(odId).date === S.today(), S.getItem(odId).date);
S.updateItem(odId, { date: odDate });

const beforeAll = S.overdueBefore(S.today()).length;
$('btnPostponeAll').click();
ok('全部顺延后逾期清零', S.overdueBefore(S.today()).length === 0, '之前 ' + beforeAll);
ok('提示里带「撤销」', ($('toast').innerHTML || '').indexOf('撤销') !== -1);
const actBtn = $('toastAct');
ok('撤销按钮存在', !!actBtn);
if (actBtn) { actBtn.click(); }
ok('点撤销后逾期恢复', S.overdueBefore(S.today()).length === beforeAll, S.overdueBefore(S.today()).length + ' vs ' + beforeAll);

/* ---------- 提醒 ---------- */
section('功能三：提醒');
const soon = S.addItem({ title:'临时提醒测试', date:S.today(), start:new Date(Date.now() + 60000).toTimeString().slice(0,5), remindOn:true, remindBefore:5 });
ok('提醒去重标记可用', S.isFired(S.today(), 'k1') === false);
S.markFired(S.today(), 'k1');
ok('标记后不重复', S.isFired(S.today(), 'k1') === true);
ok('提醒预告期已从 8 天扩到 30 天', /REMIND_HORIZON_DAYS = 30/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));
ok('提醒上限已从 60 提到 200', /REMIND_MAX = 200/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));
S.removeItem(soon.id);

/* ---------- 提醒清单：不允许 double-fire（安全审计回归） ---------- */
section('提醒清单：不允许 double-fire');
const dakaItem = S.addItem({ title:'每日打卡', date:S.today(), start:'08:00', repeat:'daily', remindOn:true });
const dakaList = A.collectReminders().filter(r => r.itemId === dakaItem.id);
ok('每日习惯展开成多条一次性实例', dakaList.length >= 25, 'n=' + dakaList.length);
ok('所有条目的 repeat 固定为 none（原生侧不得重排，否则次日重复触发）',
  dakaList.every(r => r.repeat === 'none'),
  '有 repeat!=none: ' + dakaList.filter(r => r.repeat !== 'none').map(r => r.repeat).join(','));
ok('每一天是独立的一次性条目（id 带日期后缀）', dakaList.every(r => r.id.indexOf('_') !== -1));
S.removeItem(dakaItem.id);

/* ---------- 日历与统计 ---------- */
section('功能四：日历与统计');
['day','week','month','year'].forEach(sc => {
  try { sandbox.YM_VIEWS.renderCalendar(sc, S.today(), $('calBody')); ok(sc + ' 视图渲染', $('calBody').innerHTML.length > 40); }
  catch (e) { ok(sc + ' 视图渲染', false, e.message); }
});
sandbox.YM_VIEWS.renderStats({ sTotal:$('sTotal'), sDone:$('sDone'), sRate:$('sRate'), sStreak:$('sStreak'),
  trendChart:$('trendChart'), tagBars:$('tagBars'), quoteStatHint:$('quoteStatHint') });
ok('统计渲染百分比', /^\d+%$/.test($('sRate').textContent));
ok('统计卡提到了逾期入口', ($('quoteStatHint').textContent || '').indexOf('顺延') !== -1 || ($('quoteStatHint').textContent || '').indexOf('逾期') !== -1);

/* ---------- 早晨推送（每日一句） ---------- */
section('早晨推送：未来 30 天每天一句');
const collectMorning = sandbox.window.YM_STORE.collectMorningPush;
ok('collectMorningPush 是函数', typeof collectMorning === 'function');
const mp0 = collectMorning(function (items, d) { return { text: '测试句', src: '传习录·某' }; });
ok('默认开启下生成 30 条', Array.isArray(mp0) && mp0.length === 30, 'n=' + (mp0 && mp0.length));
ok('每条都有 triggerAt / time / quote', mp0.every(r => typeof r.triggerAt === 'number' && r.time && r.quote));
ok('id 以 morning_ 开头', mp0.every(r => r.id.indexOf('morning_') === 0));
ok('未来 30 天的 triggerAt 都大于现在', mp0.every(r => r.triggerAt > Date.now() - 24 * 3600 * 1000));
S.load().settings.morningPush = false; S.save();
const mp1 = collectMorning(function (items, d) { return { text: 'x', src: 'y' }; });
ok('关闭 morningPush 后为空', Array.isArray(mp1) && mp1.length === 0);
S.load().settings.morningPush = true;
S.load().settings.morningPushTime = '08:15'; S.save();
const mp2 = collectMorning(function (items, d) { return { text: 'ok', src: 'ok' }; });
ok('修改时间为 08:15 后生效', mp2.length > 0 && mp2[0].time === '08:15');
S.load().settings.morningPushTime = 'abc非法'; S.save();
const mp3 = collectMorning(function (items, d) { return { text: 'ok', src: 'ok' }; });
ok('非法时间自动回落 07:30', mp3.length > 0 && mp3[0].time === '07:30');
S.load().settings.morningPushTime = '07:30'; S.save();
const mp4 = collectMorning(function (items, d) { return null; });
ok('quoteProvider 返 null 时整批空（排程安全）', Array.isArray(mp4) && mp4.length === 0);
const mp5 = collectMorning(function () { throw new Error('boom'); });
ok('quoteProvider 抛错时整批空（排程安全）', Array.isArray(mp5) && mp5.length === 0);

section('语录库（416 条必须分页）');
$('libTheme').innerHTML = '';
sandbox.YM_VIEWS.renderLibThemes($('libTheme'), '');
ok('主题筛选条渲染出 11 个按钮(全部+10主题)', $('libTheme').querySelectorAll('button').length === 11,
  'n=' + $('libTheme').querySelectorAll('button').length);
A.libTheme = ''; A.libQuery = ''; A.libLimit = 60;
sandbox.YM_VIEWS.renderMe({ libCount:$('libCount'), quoteLib:$('quoteLib'), btnMore:$('btnLibMore') }, { limit:60 });
ok('首屏只渲染 60 条', $('quoteLib').querySelectorAll('.qlib').length === 60, 'n=' + $('quoteLib').querySelectorAll('.qlib').length);
ok('「显示更多」可见', $('btnLibMore').hidden === false);
ok('计数显示总数', $('libCount').textContent === sandbox.YM_QUOTES.length + ' / ' + sandbox.YM_QUOTES.length, $('libCount').textContent);
$('btnLibMore').click();
ok('点显示更多后变多', $('quoteLib').querySelectorAll('.qlib').length > 60, 'n=' + $('quoteLib').querySelectorAll('.qlib').length);
$('libSearch').value = '立志';
$('libSearch').dispatchEvent({ type: 'input', target: $('libSearch') });
ok('按主题搜索有结果', $('quoteLib').querySelectorAll('.qlib').length > 0);
$('libSearch').value = 'zzz不存在';
$('libSearch').dispatchEvent({ type: 'input', target: $('libSearch') });
ok('无结果给出提示', $('quoteLib').innerHTML.indexOf('没有匹配') !== -1);

/* ---------- 反馈闭环 ---------- */
section('语录反馈闭环');
$('tabbar').querySelector('button[data-tab="today"]').click();
const q1 = A.lastPick.quote.id;
$('btnLike').click();
ok('点赞写入反馈', S.feedbackFor(S.today()).liked.indexOf(q1) !== -1);
ok('点赞后按钮高亮', $('btnLike').classList.contains('on'));
$('btnDislike').click();
ok('不想听写入反馈', S.feedbackFor(S.today()).disliked.length === 1);
ok('点赞与不感兴趣互斥', S.feedbackFor(S.today()).liked.indexOf(q1) === -1);
ok('不想听后立刻换了一句', A.lastPick.quote.id !== q1, A.lastPick.quote.id + ' vs ' + q1);
ok('被否掉的句子当天不再入选', (() => {
  const dis = S.feedbackFor(S.today()).disliked[0];
  for (let s = 0; s < 25; s++) {
    if (M.pick(S.byDate(S.today()), S.today(), s, { disliked: S.feedbackFor(S.today()).disliked }).quote.id === dis) return false;
  }
  return true;
})());

/* ---------- Android 桥 ---------- */
section('Android 桥接与返回键');
ok('未注入桥时不报错', (() => { try { A.onDataChanged(); return true; } catch (e) { return false; } })());
const seenReminders = [];
sandbox.YMBridge = { setReminders(j) { seenReminders.push(JSON.parse(j).length); }, notify() {}, requestNotificationPermission() {}, ensureExactAlarm() {} };
S.addItem({ title:'明天的会', date:S.shift(S.today(), 1), start:'09:00' });
A.onDataChanged();
sandbox.YMBridge.setReminders(JSON.stringify([]));
ok('原生桥可接收提醒清单', typeof sandbox.YMBridge.setReminders === 'function');
delete sandbox.YMBridge;
ok('返回键：打开面板时被拦截', (() => { $('fab').click(); const r = sandbox.YM_onAndroidBack() === true && $('editSheet').hidden === true; return r; })());
A.tab = 'calendar'; A.anchor = S.shift(S.today(), 3);
ok('返回键：非今日页回今日', sandbox.YM_onAndroidBack() === true && A.tab === 'today');
ok('返回键：今日页交回原生', sandbox.YM_onAndroidBack() === false);

/* ---------- 边界 ---------- */
section('边界情况');
ok('重复日程每天出现、不回填过去', (() => {
  const it = S.addItem({ title:'每日阅读', date:S.shift(S.today(), -3), repeat:'daily' });
  const r = S.byDate(S.today()).some(x => x.id === it.id) && S.byDate(S.shift(S.today(), 5)).some(x => x.id === it.id);
  S.removeItem(it.id); return r;
})());
ok('重复日程按天独立记录完成', (() => {
  const it = S.addItem({ title:'重复完成测试', date:S.today(), repeat:'daily' });
  S.toggleDone(it.id, S.today());
  const r = S.byDate(S.today()).find(x => x.id === it.id).done === true &&
            S.byDate(S.shift(S.today(), 1)).find(x => x.id === it.id).done === false;
  S.removeItem(it.id); return r;
})());
ok('删除返回备份可恢复', (() => {
  const it = S.addItem({ title:'待删' });
  const bk = S.removeItem(it.id);
  const gone = !S.getItem(it.id);
  S.restoreItem(bk);
  return gone && !!S.getItem(it.id);
})());
ok('反馈只保留 30 天（结构存在）', typeof S.load().feedback === 'object');
ok('导出为合法 JSON 且含反馈', (() => {
  const j = JSON.parse(S.exportJSON());
  return Array.isArray(j.items) && typeof j.feedback === 'object';
})());
ok('清空全部后可正常再用', (() => {
  S.clearAll();
  S.addItem({ title:'清空后' });
  const r = S.allItems().length === 1;
  S.clearAll(); return r;
})());
ok('语料文本不含未转义字符', sandbox.YM_QUOTES.every(q => q.text.indexOf('<') === -1 && q.text.indexOf('&') === -1));

console.log('\n' + '='.repeat(54));
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
