/* ============================================================
 * 匹配引擎
 *
 * 设计原则（都是踩过坑才定下来的）：
 * 1. 语料多了以后，"标签匹配"会被稀释 —— 所以有近义扩展 + 冷启动兜底
 * 2. 完成率低的时候绝不给"律己型"语录 —— 那不是鼓励，是指责
 *    strict 只在用户自己表达了向上意图（规划、学习、复盘）时才出现
 * 3. 理由只给情绪，不给实现 —— 一旦用户看到"识别到：工作、复盘"，
 *    "它懂我"就退化成"关键词匹配"了
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 1. 分词：词典扫描 + 长词优先 + 占位防重复 ---------- */
  var LEXICON = (function () {
    var list = [];
    for (var k in global.YM_TAG_ALIAS) {
      if (Object.prototype.hasOwnProperty.call(global.YM_TAG_ALIAS, k)) list.push(k);
    }
    list.sort(function (a, b) { return b.length - a.length; });
    return list;
  })();

  var TAG_SET = (function () {
    var s = {};
    for (var k in global.YM_TAG_ALIAS) {
      if (Object.prototype.hasOwnProperty.call(global.YM_TAG_ALIAS, k)) s[global.YM_TAG_ALIAS[k]] = 1;
    }
    (global.YM_QUOTES || []).forEach(function (q) {
      (q.tags || []).forEach(function (t) { s[t] = 1; });
    });
    (global.YM_TAG_POOL || []).forEach(function (t) { s[t] = 1; });
    return s;
  })();

  function extractTags(text, weight) {
    var w = weight === undefined ? 1 : weight;
    var out = {};
    if (!text) return out;
    var src = String(text);
    var lower = src.toLowerCase();
    var consumed = [];
    for (var z = 0; z < src.length; z++) consumed.push(false);

    LEXICON.forEach(function (word) {
      var lw = word.toLowerCase();
      var idx = lower.indexOf(lw);
      while (idx !== -1) {
        var free = true;
        for (var i = idx; i < idx + word.length; i++) if (consumed[i]) { free = false; break; }
        if (free) {
          for (var j = idx; j < idx + word.length; j++) consumed[j] = true;
          var tag = global.YM_TAG_ALIAS[word];
          out[tag] = (out[tag] || 0) + w;
        }
        idx = lower.indexOf(lw, idx + 1);
      }
    });
    return out;
  }

  /** 近义扩展：把稀薄标签的语义邻居以降权方式并进来 */
  function relatedExpand(tagScores, factor) {
    var f = factor === undefined ? 0.45 : factor;
    var out = {};
    for (var k in tagScores) if (tagScores.hasOwnProperty.call(tagScores, k)) out[k] = tagScores[k];
    for (var t in tagScores) {
      if (!tagScores.hasOwnProperty.call(tagScores, t)) continue;
      var near = global.YM_TAG_RELATED[t];
      if (!near) continue;
      for (var i = 0; i < near.length; i++) {
        out[near[i]] = (out[near[i]] || 0) + tagScores[t] * f;
      }
    }
    return out;
  }

  /* ---------- 2. 从当天记录推导状态 ---------- */
  function isPast(dateStr, hhmm) {
    if (!hhmm) return false;
    return new Date(dateStr + 'T' + hhmm + ':00').getTime() < Date.now();
  }

  function judgeMood(items) {
    var total = items.length;
    if (total === 0) return { key:'empty', rate:0, done:0, total:0, overdue:0 };

    var done = items.filter(function (i) { return i.done; }).length;
    var overdue = items.filter(function (i) {
      return !i.done && isPast(i.date, i.start);
    }).length;
    var rate = done / total;

    var key = rate >= 0.8 ? 'high' : rate >= 0.5 ? 'mid' : 'low';
    return { key: key, rate: rate, done: done, total: total, overdue: overdue };
  }

  function partOfDay() {
    var h = new Date().getHours();
    if (h < 5) return 'night';
    if (h < 11) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
  }

  /* ---------- 3. 语气门控 ----------
   * strict 是"要求你"，warm 是"理解你"，clear 是"把事说明白"
   * 完成率低的时候给 strict，用户读到的是指责；只有他自己在规划未来时，strict 才是助力
   */
  var USER_INTENT_TAGS = ['立志','目标','计划','方向','行动','执行','学习','为学','读书',
    '复盘','自省','自律','坚持','习惯','专注','效率','改变','成长','深度','积累'];

  function hasUpwardIntent(tagScores) {
    for (var i = 0; i < USER_INTENT_TAGS.length; i++) {
      var t = USER_INTENT_TAGS[i];
      if (tagScores[t] && tagScores[t] >= 1) return true;
    }
    return false;
  }

  var TONE_WEIGHT = {
    /*          warm  clear  strict */
    low:    { warm: 1.80, clear: 1.15, strict: 0.95 },  // strict 靠上面的硬过滤兜底
    mid:    { warm: 1.30, clear: 1.30, strict: 1.00 },
    high:   { warm: 1.15, clear: 1.40, strict: 1.10 },
    empty:  { warm: 1.30, clear: 1.15, strict: 0.90 }
  };
  var INTENT_BONUS = { low: 1.5, mid: 1.25, high: 1.1, empty: 1.15 };

  /* ---------- 4. 稳定伪随机：同日同批事恒定同一句 ---------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /* ---------- 5. 冷启动兜底 ----------
   * 信息量不足（少于 3 条）时，不拿稀疏标签去硬匹配，
   * 而是在一个人工圈定的高品质小池子里，按状态和时段挑
   */
  function fallbackKey(mood) {
    var p = partOfDay();
    if (mood.key === 'empty') return 'emptyDay';
    if (mood.key === 'low') return 'lowDay';
    if (mood.key === 'high') return 'highDay';
    return p === 'morning' ? 'morning' : p === 'evening' || p === 'night' ? 'evening' : 'afternoon';
  }

  function fallbackCandidates(mood) {
    var pool = global.YM_FALLBACK[fallbackKey(mood)] || [];
    var tagSet = {};
    pool.forEach(function (t) { tagSet[t] = 1; });
    // 兜底池里的标签也做一次近义扩展，保证池子够大
    var expanded = relatedExpand(tagSet, 0.5);
    var cands = global.YM_QUOTES.filter(function (q) {
      for (var i = 0; i < q.tags.length; i++) if (expanded[q.tags[i]]) return true;
      return false;
    });
    return cands.length >= 10 ? cands : global.YM_QUOTES.slice();
  }

  /* ---------- 6. 主入口 ---------- */
  function pick(items, dateStr, salt, opts) {
    salt = salt || 0;
    opts = opts || {};
    var mood = judgeMood(items);
    var liked = opts.liked || [];
    var disliked = opts.disliked || [];

    /* 6.1 汇总当天标签 */
    var raw = {};
    items.forEach(function (it) {
      var w = it.done ? 0.7 : 1.4;          // 没做的事更需要被回应
      var bag = extractTags(it.title, w);
      var bag2 = extractTags(it.note, w * 0.6);
      (it.tags || []).forEach(function (tg) { bag[tg] = (bag[tg] || 0) + w * 1.2; });
      [bag, bag2].forEach(function (b) {
        for (var k in b) if (b.hasOwnProperty.call(b, k)) raw[k] = (raw[k] || 0) + b[k];
      });
    });
    if (mood.overdue > 0) raw['拖延'] = (raw['拖延'] || 0) + mood.overdue * 1.5;

    var coldStart = items.length < 3;
    var tagScores = coldStart ? {} : relatedExpand(raw, 0.45);
    var intent = hasUpwardIntent(raw);

    /* 6.2 候选集 */
    var candidates = coldStart ? fallbackCandidates(mood) : global.YM_QUOTES;
    if (!candidates.length) candidates = global.YM_QUOTES;

    /* 6.2.1 语气底线（硬过滤，不是加权）
     * 今天已经落下事情、而用户并没有表达"我要往前推"的意图时，
     * 绝不给 strict（"你应该""志不立无可成之事"这种）—— 那不是鼓励，是指责。
     * 加权做不到这个保证，所以这里是硬排除。
     * 空白的一天不受限制：还没开始，立个意思是合适的。 */
    var strictFiltered = false;
    if (mood.key === 'low' && !intent) {
      var gentle = candidates.filter(function (q) { return q.tone !== 'strict'; });
      if (gentle.length >= 8) { candidates = gentle; strictFiltered = true; }
    }

    /* 6.3 打分 */
    var tw = TONE_WEIGHT[mood.key];
    var signature = dateStr + '|' + salt + '|' +
      items.map(function (i) { return (i.done ? '1' : '0') + i.title; }).join('') + '|' + partOfDay();

    var scored = [];
    candidates.forEach(function (q) {
      if (disliked.indexOf(q.id) !== -1) return;   // 今天不想听，今天就不再出现

      var s = 0;
      q.tags.forEach(function (t) {
        var v = tagScores[t];
        if (v) s += v * 2.2;
        else if (!coldStart && TAG_SET[t]) s += 0.3;
      });

      var toneW = tw[q.tone] || 1;
      if (q.tone === 'strict' && intent) toneW *= INTENT_BONUS[mood.key];
      s *= toneW;

      if (liked.indexOf(q.id) !== -1) s *= 0.55;   // 听过且点了"说得对"，今天换个角度

      s += hash(q.id + '::' + signature) * 2.2;    // 同日同状态稳定，跨天自然轮换
      scored.push({ q: q, score: s });
    });

    if (!scored.length) return pick(items, dateStr, salt, { liked: liked, disliked: [] });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.q.id < b.q.id ? -1 : 1;
    });

    var winner = scored[0].q;
    return {
      quote: winner,
      reason: buildReason(winner, mood, raw, coldStart),
      mood: mood,
      coldStart: coldStart,
      tone: winner.tone,
      /* 以下三个字段只给测试和调试用，界面不读 */
      intent: intent,
      strictFiltered: strictFiltered,
      tagScores: raw
    };
  }

  /* ---------- 7. 理由：只给情绪，不给实现 ---------- */
  var OPENING = {
    empty:  ['今天还是一张白纸。', '还没开始写今天。'],
    low:    ['今天有点沉。', '今天落下几件。'],
    mid:    ['今天走了一半。', '今天在动。'],
    high:   ['今天收得挺干净。', '今天交代得清楚。']
  };
  var TONE_TAIL = {
    warm:  ['所以挑了句不那么紧的。', '没给你讲课，就一句松一点的。', '所以挑了句站在你这边的话。'],
    clear: ['所以挑了句把事说明白的。', '给你一句能把心放平的。', '所以挑了句讲道理的。'],
    strict:['所以挑了句提醒你当初为什么开始的。', '你自己在往前推，那就给你一句硬一点的话。']
  };
  var TIME_PREFIX = { night:'夜深了。', morning:'一天刚开始。', afternoon:'', evening:'一天快过完了。' };
  var EMPTY_TAIL = {
    warm:  ['先给你一句，定个调子。'],
    clear: ['先给你一句，理顺一下。'],
    strict:['先给你一句，立个意思。']
  };

  function buildReason(q, mood, raw, coldStart) {
    var parts = [];
    var prefix = TIME_PREFIX[partOfDay()];
    if (prefix) parts.push(prefix);

    if (mood.total === 0) {
      parts.push(OPENING.empty[Math.floor(hash(q.id + 'e') * OPENING.empty.length)]);
      parts.push(EMPTY_TAIL[q.tone][0]);
      return parts.join('');
    }

    parts.push(OPENING[mood.key][Math.floor(hash(q.id + 'o') * 2)]);

    var facts = [];
    if (mood.overdue > 0) facts.push('有 ' + mood.overdue + ' 件已经过了时点还悬着');
    if (mood.key === 'high') facts.push(mood.total + ' 件划掉了 ' + mood.done + ' 件');
    else if (mood.done > 0) facts.push('' + mood.done + '/' + mood.total);
    if (facts.length) parts.push('（' + facts.join('，') + '）');

    var tails = TONE_TAIL[q.tone] || TONE_TAIL.clear;
    parts.push(tails[Math.floor(hash(q.id + 't') * tails.length)]);
    return parts.join('');
  }

  global.YM_MATCH = {
    pick: pick,
    extractTags: extractTags,
    relatedExpand: relatedExpand,
    judgeMood: judgeMood,
    partOfDay: partOfDay,
    allTags: function () { return Object.keys(TAG_SET).sort(); }
  };
})(window);
