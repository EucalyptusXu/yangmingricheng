/* 极简 DOM 桩：解析 index.html 建树，支持 querySelector/事件冒泡，用于跑真实渲染路径 */
'use strict';

function camel(s) { return s.replace(/^data-/, '').replace(/-([a-z])/g, (m, c) => c.toUpperCase()); }

class ClassList {
  constructor(el) { this.el = el; }
  get set() { return this.el._classes; }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; on ? this.set.add(c) : this.set.delete(c); return on; }
}

class El {
  constructor(tag, attrs, doc) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.attrs = attrs || {};
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
    this._text = '';
    this._classes = new Set();
    this.dataset = {};
    this.style = {};
    this.id = '';
    this.value = '';
    this.checked = false;
    this.clientWidth = 320;
    this.clientHeight = 150;
    this.classList = new ClassList(this);

    if (this.attrs.id) this.id = this.attrs.id;
    if (this.attrs.class) this.attrs.class.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    for (const k in this.attrs) if (k.startsWith('data-')) this.dataset[camel(k)] = this.attrs[k];
    this.hidden = this.attrs.hidden !== undefined;
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }

  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  get _all() { const out = []; const walk = n => n.children.forEach(c => { out.push(c); walk(c); }); walk(this); return out; }

  get innerHTML() { return this._html || this._serialize(); }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    parseFragment(this._html, this, this.doc);
  }
  _serialize() {
    return this.children.map(c => {
      const attrs = Object.keys(c.attrs).map(k => ` ${k}="${c.attrs[k]}"`).join('');
      return `<${c.tagName.toLowerCase()}${attrs}>${c.innerHTML || c._text}</${c.tagName.toLowerCase()}>`;
    }).join('');
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get firstChild() { return this.children[0] || null; }

  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const a = this._listeners[type]; if (!a) return;
    const i = a.indexOf(fn); if (i !== -1) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    let n = this;
    const chain = [];
    while (n) { chain.push(n); n = n.parentNode; }
    chain.push(this.doc);
    for (const node of chain) {
      const fns = node._listeners && node._listeners[ev.type];
      if (fns) fns.slice().forEach(f => f.call(node, ev));
      if (ev._stopped) break;
    }
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() { this._stopped = true; } }); }
  focus() {} select() {} blur() {} remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
  }
  getContext() { return null; }
  closest(sel) { let n = this; while (n) { if (n !== this.doc && matchSimple(n, sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
}

function matchSimple(el, sel) {
  if (!el || !el.tagName) return false;
  const attrRe = /\[([\w-]+)(?:=(["']?)([^\]]*?)\2)?\]/g;
  let m, bad = false;
  while ((m = attrRe.exec(sel))) {
    const name = m[1], val = m[3];
    let have;
    if (name === 'id') have = el.id;
    else if (el.attrs[name] !== undefined) have = el.attrs[name];
    else if (el.dataset[camel(name)] !== undefined) have = el.dataset[camel(name)];
    if (have === undefined || (val !== undefined && val !== '' && String(have) !== val)) { bad = true; break; }
  }
  if (bad) return false;
  sel = sel.replace(attrRe, '').trim();
  if (!sel) return true;
  const idParts = sel.split('#');
  sel = idParts.shift();
  for (const p of idParts) if (el.id !== p) return false;
  const clsParts = sel.split('.');
  const tag = clsParts.shift();
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const c of clsParts) if (c && !el.classList.contains(c)) return false;
  return true;
}

function matchChain(el, parts) {
  if (!parts.length) return true;
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let rest = parts.slice(0, -1);
  let n = el.parentNode;
  while (rest.length && n) {
    if (n.tagName && matchSimple(n, rest[rest.length - 1])) rest = rest.slice(0, -1);
    n = n.parentNode;
  }
  return rest.length === 0;
}

function queryAll(root, sel) {
  const parts = String(sel).trim().split(/\s+/);
  return root._all.filter(el => matchChain(el, parts));
}

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'col', 'base', 'wbr']);

function parseFragment(html, parent, doc) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  const stack = [parent];
  let m;
  while ((m = re.exec(html))) {
    const [full, close, open, attrStr, selfClose, text] = m;
    if (full.startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === close.toUpperCase()) { stack.length = i; break; }
      }
    } else if (open) {
      const attrs = parseAttrs(attrStr || '');
      const el = new El(open, attrs, doc);
      top.appendChild(el);
      if (!selfClose && !VOID.has(open.toLowerCase())) stack.push(el);
    } else if (text !== undefined) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t) top._text += t;
    }
  }
}

function parseAttrs(s) {
  const out = {};
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1];
    if (k === '/' || !k) continue;
    out[k] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return out;
}

function buildDocument(html) {
  const doc = new El('html', {}, null);
  doc.doc = doc;
  doc.readyState = 'complete';
  doc.hidden = false;
  const bodyStart = html.indexOf('<body');
  const body = html.slice(bodyStart === -1 ? 0 : html.indexOf('>', bodyStart) + 1, html.lastIndexOf('</body>'));
  parseFragment(body, doc, doc);
  doc.getElementById = id => doc._all.find(e => e.id === id) || null;
  doc.querySelectorAll = sel => queryAll(doc, sel);
  doc.querySelector = sel => queryAll(doc, sel)[0] || null;
  doc.createElement = tag => new El(tag, {}, doc);
  doc.getElementsByTagName = t => doc._all.filter(e => e.tagName === t.toUpperCase());
  return doc;
}

module.exports = { buildDocument, El, matchSimple, queryAll };
