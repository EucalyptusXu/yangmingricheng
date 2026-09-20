#!/usr/bin/env node
/* ============================================================
 * 语料库校对工具
 *
 *   node tools/audit-corpus.js          体检
 *   node tools/audit-corpus.js --strict 有警告就退出码 1（可挂到 CI）
 *
 * 换成自己校订过的语料后，跑一遍这个再提交。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA_DIR = path.resolve(__dirname, '..', 'js', 'data');
/* 顺序不能改：lexicon 提供词表和主题，quotes 提供容器，分册依次 push */
const FILES = ['lexicon.js', 'quotes.js', 'quotes-01-chuanxilu.js', 'quotes-02-prose.js',
  'quotes-03-poems.js', 'quotes-04-supplement.js'];

const sandbox = { window: null, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'), sandbox, { filename: f });
}

let errors = 0, warns = 0;
const err = m => { errors++; console.log('  ✗ ' + m); };
const warn = m => { warns++; console.log('  ! ' + m); };
const okLine = m => console.log('  ✓ ' + m);

console.log('语料库校对 · ' + path.basename(DATA_DIR) + '\n');

try {
  FILES.forEach(load);
} catch (e) {
  console.log('  ✗ 加载失败：' + e.message);
  process.exit(1);
}

const Q = sandbox.YM_QUOTES || [];
const POOL = new Set(sandbox.YM_TAG_POOL || []);
const THEMES = sandbox.YM_THEMES || {};
const TONES = ['strict', 'warm', 'clear'];

/* ---------- 1. 数量 ---------- */
console.log('▸ 规模');
if (Q.length >= 400) okLine('共 ' + Q.length + ' 条（不低于 400）');
else err('只有 ' + Q.length + ' 条，低于 400');

/* ---------- 2. 结构 ---------- */
console.log('\n▸ 结构完整性');
const ids = Q.map(q => q.id), dupId = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
if (dupId.length) err('id 重复：' + dupId.join(', ')); else okLine('id 唯一');

const texts = Q.map(q => q.text);
const dupText = [...new Set(texts.filter((v, i) => texts.indexOf(v) !== i))];
if (dupText.length) { err('正文重复 ' + dupText.length + ' 条'); dupText.slice(0, 5).forEach(t => console.log('      ' + t.slice(0, 30))); }
else okLine('正文无重复');

const missing = Q.filter(q => !q.id || !q.text || !q.src || !q.theme || !q.tone || !Array.isArray(q.tags) || !q.tags.length);
if (missing.length) err('字段缺失：' + missing.map(q => q.id).join(', ')); else okLine('必填字段齐全');

const short = Q.filter(q => q.text.length > 90);
if (short.length) warn('超长条目（手机上会占太多屏）：' + short.map(q => q.id).join(', '));
else okLine('没有超长条目');

const noSrc = Q.filter(q => !/《.+》/.test(q.src));
if (noSrc.length) warn('出处格式不规范（建议统一成《篇名》）：' + noSrc.map(q => q.id).slice(0, 8).join(', '));
else okLine('出处格式统一');

/* ---------- 3. 词表一致性 ---------- */
console.log('\n▸ 标签与主题');
const outTags = [...new Set(Q.flatMap(q => q.tags))].filter(t => !POOL.has(t));
if (outTags.length) err('标签不在 YM_TAG_POOL 内：' + outTags.join(' / ')); else okLine('标签全部在池内');

const badTheme = [...new Set(Q.map(q => q.theme))].filter(t => !THEMES[t]);
if (badTheme.length) err('主题没有配置：' + badTheme.join(', ')); else okLine('主题全部有配置');

const badTone = [...new Set(Q.map(q => q.tone))].filter(t => TONES.indexOf(t) === -1);
if (badTone.length) err('语气值非法：' + badTone.join(', ')); else okLine('语气值合法');

const noColor = Object.keys(THEMES).filter(t => !THEMES[t].color);
if (noColor.length) err('主题缺配色：' + noColor.join(', ')); else okLine('每个主题都有配色');

/* ---------- 4. 分布 ---------- */
console.log('\n▸ 语气配平');
const toneN = { strict: 0, warm: 0, clear: 0 };
Q.forEach(q => toneN[q.tone] = (toneN[q.tone] || 0) + 1);
const pctOf = n => Math.round(n / Q.length * 100);
console.log('   律己(strict) ' + toneN.strict + ' 条 · ' + pctOf(toneN.strict) + '%');
console.log('   体谅(warm)  ' + toneN.warm + ' 条 · ' + pctOf(toneN.warm) + '%');
console.log('   说明(clear) ' + toneN.clear + ' 条 · ' + pctOf(toneN.clear) + '%');
if (pctOf(toneN.strict) > 45) warn('律己型偏多（>45%），用户累的时候容易被"教育"');
else okLine('律己型占比健康（' + pctOf(toneN.strict) + '% ≤ 45%）');
if (pctOf(toneN.warm) < 30) warn('体谅型偏少（<30%），建议补"心境/日常/山水/人情"类的句子');
else okLine('体谅型占比充足（' + pctOf(toneN.warm) + '% ≥ 30%）');
if (toneN.strict > 0 && toneN.warm > 0 && toneN.clear > 0) okLine('三种语气都存在');
else err('有语气类别为空：' + JSON.stringify(toneN));

console.log('\n▸ 主题分布');
const themeN = {};
Q.forEach(q => themeN[q.theme] = (themeN[q.theme] || 0) + 1);
Object.keys(THEMES).forEach(t => {
  const n = themeN[t] || 0;
  const tag = n === 0 ? '✗' : n < 10 ? '!' : '✓';
  if (n === 0) errors++; else if (n < 10) warns++;
  console.log('   ' + tag + ' ' + t + ' ' + n + ' 条');
});

/* ---------- 5. 匹配可用性 ---------- */
console.log('\n▸ 匹配可用性');
const RELATED = sandbox.YM_TAG_RELATED || {};
const missRelated = [...POOL].filter(t => !RELATED[t]);
if (missRelated.length > 20) warn('近义扩展表有 ' + missRelated.length + ' 个标签未挂邻居：' + missRelated.slice(0, 10).join(' '));
else okLine('近义扩展表覆盖良好（缺 ' + missRelated.length + ' 个）');

const FALLBACK = sandbox.YM_FALLBACK || {};
let fbBad = 0;
Object.keys(FALLBACK).forEach(k => {
  const n = Q.filter(q => q.tags.some(t => FALLBACK[k].indexOf(t) !== -1)).length;
  if (n < 12) { fbBad++; warn('兜底池 ' + k + ' 只有 ' + n + ' 条候选（建议 ≥12）'); }
});
if (!fbBad) okLine('6 个兜底池候选都充足');

const idx = sandbox.YM_TAG_ALIAS || {};
const aliasTargets = new Set(Object.values(idx));
const orphan = [...aliasTargets].filter(t => !Q.some(q => q.tags.indexOf(t) !== -1));
if (orphan.length) warn('用户可能写出来、但没有任何语料承接的标签：' + orphan.join(' '));
else okLine('别名表指向的标签都有语料承接');

const avgTags = (Q.reduce((a, q) => a + q.tags.length, 0) / Q.length);
console.log('   平均每条 ' + avgTags.toFixed(2) + ' 个标签' + (avgTags > 5 ? '（偏多，容易误命中）' : ''));

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(46));
console.log('错误 ' + errors + ' · 警告 ' + warns);
if (errors) process.exitCode = 1;
else if (warns && process.argv.indexOf('--strict') !== -1) process.exitCode = 1;
