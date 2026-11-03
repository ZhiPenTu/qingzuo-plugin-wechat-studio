const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g;
const CITATION = /（资料路径[:：]\s*`[^`]+?`）/g;
const QUOTE_CARD = /^(.*?)\s*(?:——|—|--)\s*([^\s—][^—]{0,24})$/;

export function cjkCount(value) {
  return (String(value || '').match(CJK) || []).length;
}

export function parseRange(value, fallback = [800, 4000]) {
  const match = String(value || '').match(/(\d+)\s*[-–—~至]\s*(\d+)/);
  if (!match) return fallback;
  const low = Number(match[1]);
  const high = Number(match[2]);
  return low <= high ? [low, high] : [high, low];
}

export function stripCitations(text) {
  const source = String(text || '');
  const cleaned = source
    .replace(CITATION, '')
    .split('\n')
    .map(line => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return source.endsWith('\n') && !cleaned.endsWith('\n') ? cleaned + '\n' : cleaned;
}

export function extractBoldOutline(text) {
  return [...String(text || '').matchAll(/\*\*([^*\n]+)\*\*/g)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

export function splitMarkdownBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let current = [];
  let fenced = false;
  const flush = () => {
    if (!current.length) return;
    blocks.push({ kind: 'paragraph', text: current.join('\n').trim() });
    current = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!fenced) flush();
      fenced = !fenced;
      current.push(line);
      if (!fenced) flush();
      continue;
    }
    if (fenced) {
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^(#{1,6})\s+/.test(line)) {
      flush();
      blocks.push({ kind: 'heading', level: line.match(/^#+/)[0].length, text: line.replace(/^#{1,6}\s+/, '').trim() });
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      blocks.push({ kind: 'list', text: line.trim() });
      continue;
    }
    if (/^>/.test(line)) {
      flush();
      blocks.push({ kind: 'quote', text: line.replace(/^>\s?/, '').trim() });
      continue;
    }
    if (/^!\[.*\]\(.*\)$/.test(line.trim())) {
      flush();
      blocks.push({ kind: 'image', text: line.trim() });
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

export function checkDraft(text, config = {}) {
  const source = String(text || '');
  const lines = source.split('\n');
  const blocks = splitMarkdownBlocks(source);
  const headings = blocks.filter(block => block.kind === 'heading');
  const h2 = headings.filter(block => block.level === 2);
  const [minWords, maxWords] = parseRange(config.target_word_count, [800, 4000]);
  const body = blocks
    .filter(block => ['paragraph', 'list', 'quote'].includes(block.kind))
    .map(block => block.text)
    .join('\n');
  const words = cjkCount(body);
  const bolds = extractBoldOutline(body);
  const firstH2 = lines.findIndex(line => /^##\s+/.test(line));
  const leadEnd = firstH2 < 0 ? lines.length : firstH2;
  const lead = lines.slice(0, leadEnd).some(line => /^>\s*\S/.test(line));
  const quoteCards = blocks
    .filter(block => block.kind === 'quote')
    .map(block => block.text.match(QUOTE_CARD))
    .filter(Boolean);
  const issues = [];
  const warnings = [];

  if (!/^#\s+\S/m.test(source)) issues.push('缺少以「# 」开头的文章标题。');
  if (!lead) issues.push('第一个二级标题之前缺少「> 」摘要导语。');
  if (h2.length < 2) issues.push('至少需要两个「## 」正文小节。');
  if (words < Math.round(minWords * 0.75)) issues.push('正文仅约 ' + words + ' 字，低于目标 ' + minWords + ' 字的四分之三。');
  if (words > Math.round(maxWords * 1.35)) warnings.push('正文约 ' + words + ' 字，明显超过目标上限 ' + maxWords + ' 字。');

  if (words >= 300) {
    const needed = Math.max(1, Math.floor(words / 100));
    if (bolds.length < needed) issues.push('正文约 ' + words + ' 字只有 ' + bolds.length + ' 处加粗，至少需要 ' + needed + ' 处。');
    let gap = 0;
    let worst = 0;
    for (const block of blocks) {
      if (!['paragraph', 'list'].includes(block.kind)) continue;
      const count = cjkCount(block.text);
      if (/\*\*[^*\n]+\*\*/.test(block.text)) {
        worst = Math.max(worst, gap);
        gap = 0;
      } else {
        gap += count;
      }
    }
    worst = Math.max(worst, gap);
    if (worst > 200) issues.push('有一段连续 ' + worst + ' 字没有任何加粗落点。');
  }

  if (quoteCards.length !== 1) {
    warnings.push('金句卡应恰好一处，当前识别到 ' + quoteCards.length + ' 处。');
  }
  const listCount = blocks.filter(block => block.kind === 'list').length;
  if (words > 1000 && listCount === 0) warnings.push('全文没有列表；三项以上并列应拆成「- **标签**：说明」。');
  if (/（资料路径[:：]/.test(source)) warnings.push('正文仍含资料引用标注，定稿前应剥离。');

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    metrics: {
      words,
      minWords,
      maxWords,
      headings: h2.length,
      bolds: bolds.length,
      quoteCards: quoteCards.length,
      lists: listCount,
    },
    outline: bolds,
  };
}

export function normalizeBodyMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitTitleAndBody(text) {
  const normalized = normalizeBodyMarkdown(text);
  const match = normalized.match(/^#\s+(.+)\n+([\s\S]*)$/);
  return match
    ? { title: match[1].trim(), body: match[2].trim() }
    : { title: '', body: normalized };
}

export { QUOTE_CARD };
