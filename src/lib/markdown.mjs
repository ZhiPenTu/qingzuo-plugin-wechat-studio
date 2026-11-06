import { substituteTheme } from './styles.mjs';
import { fenceInfo, lineCodeFlags } from './markdown-syntax.mjs';

export { fenceInfo, lineCodeFlags } from './markdown-syntax.mjs';

export const INFO_SLOT_FORMS = new Set(['信息图', '实证', '流程图', '对比']);

export function isCoverImageAlt(alt) {
  const value = String(alt || '');
  const type = (value.includes('：') ? value.split('：', 1)[0].trim() : value.split(':', 1)[0].trim()).toLowerCase();
  return type === '封面' || type === 'cover';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function normalizeEmbedName(value) {
  return String(value || '').replace(/\s+/g, '');
}

const PROTECT = [
  [/`[^`\n]+`/g, true],
  [/\]\([^)\s]+(?:\s+["“'‘][^"”'’]*["”'’])?\)/g, false],
  [/\{embed:\w+:[^}\n]+\}/g, false],
  [/<[A-Za-z/][^>\n]*>/g, true],
  [/https?:\/\/[^\s<>()"']+/g, true],
];

function protectFencedBlocks(text, protectedParts) {
  const lines = String(text).split('\n');
  const flags = lineCodeFlags(lines);
  const output = [];
  let index = 0;
  while (index < lines.length) {
    if (!flags[index]) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < lines.length && flags[index]) index += 1;
    protectedParts.push(lines.slice(start, index).join('\n'));
    output.push('\u0000' + (protectedParts.length - 1) + '\u0000');
  }
  return output.join('\n');
}

export function preformatMarkdown(text) {
  const protectedParts = [];
  let result = protectFencedBlocks(String(text ?? ''), protectedParts);
  for (const [pattern, spaced] of PROTECT) {
    result = result.replace(pattern, match => {
      protectedParts.push(match);
      return (spaced ? '\u0000' : '\u0002') + (protectedParts.length - 1) + (spaced ? '\u0000' : '\u0002');
    });
  }
  result = result
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
    .replace(/([\u3400-\u9fff])(\d)/g, '$1 $2')
    .replace(/(\d)([\u3400-\u9fff])/g, '$1 $2')
    .replace(/([\u3400-\u9fff])(\u0000\d+\u0000)/g, '$1 $2')
    .replace(/(\u0000\d+\u0000)([\u3400-\u9fff])/g, '$1 $2')
    .replace(/"([^"\n]*?)"/g, '「$1」')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\* *(.+?) *\*\*/g, '**$1**');
  return result
    .replace(/\u0000(\d+)\u0000/g, (_match, index) => protectedParts[Number(index)])
    .replace(/\u0002(\d+)\u0002/g, (_match, index) => protectedParts[Number(index)]);
}

function imageDims() {
  return '';
}

function completeImageStyle(styles = {}) {
  return (styles.img || 'max-width:100%; border-radius:4px;') +
    '; max-width:100%; height:auto; aspect-ratio:auto; object-fit:contain;';
}

function safeHref(value, image = false) {
  const text = String(value || '').trim();
  if (!text || /[\u0000-\u001f]/.test(text)) return '';
  if (text.startsWith('//')) return '';
  if (text.startsWith('#') || (!/^[a-z][a-z0-9+.-]*:/i.test(text))) {
    const pathPart = text.split(/[?#]/, 1)[0].replaceAll('\\', '/');
    if (pathPart.startsWith('/') || pathPart.split('/').some(part => part === '..')) return '';
    return text;
  }
  try {
    const url = new URL(text);
    if (image) return url.protocol === 'https:' || url.protocol === 'http:' ? text : '';
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? text : '';
  } catch {
    return '';
  }
}

export function wantCaption(alt, captionStyle) {
  const style = String(captionStyle || '').trim() || '有图注';
  if (style === '无图注') return false;
  if (style === '关键图有') {
    if (!String(alt).includes('：')) return false;
    return INFO_SLOT_FORMS.has(String(alt).split('：', 1)[0].trim());
  }
  return true;
}

export function extractImageSlots(markdown, { captionStyle = '有图注' } = {}) {
  const slots = [];
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const flags = lineCodeFlags(lines);
  for (const [lineIndex, rawLine] of lines.entries()) {
    if (flags[lineIndex]) continue;
    const line = rawLine.trim();
    const match = line.match(/^!\[(.*?)\]\(\s*(\S+?)(?:\s+["“'‘](.*?)["”'’])?\s*\)$/);
    if (!match) continue;
    const alt = match[1];
    const type = alt.includes('：') ? alt.split('：', 1)[0].trim() : alt.split(':', 1)[0].trim();
    const cover = isCoverImageAlt(alt);
    const caption = (match[3] || '').trim();
    slots.push({
      alt,
      type,
      description: alt.includes('：') ? alt.slice(alt.indexOf('：') + 1).trim() : alt,
      src: match[2],
      caption: caption && wantCaption(alt, captionStyle) ? caption : '',
      cover,
      index: slots.length,
      lineIndex,
    });
  }
  return slots;
}

function replaceEmbed(type, name, embeds = {}) {
  const key = normalizeEmbedName(name);
  const profiles = {};
  for (const profile of embeds.profiles || []) {
    for (const raw of [profile.name, profile.nickname]) {
      const value = normalizeEmbedName(raw);
      if (value) profiles[value] = profile;
    }
  }
  const miniprograms = {};
  for (const mini of embeds.miniprograms || []) {
    for (const raw of [mini.name, mini.title]) {
      const value = normalizeEmbedName(raw);
      if (value) miniprograms[value] = mini;
    }
  }
  const cards = {};
  for (const card of embeds.miniprogram_cards || []) {
    for (const raw of [card.name, card.title]) {
      const value = normalizeEmbedName(raw);
      if (value) cards[value] = card;
    }
  }
  if (type === 'profile') {
    const item = profiles[key];
    if (!item) return '<!-- 未找到公众号名片配置: ' + escapeHtml(key) + ' -->';
    const id = String(item.profile_id || item.id || '').trim();
    const headimg = String(item.headimg || '').trim();
    if (id && headimg) {
      return '<mp-common-profile class="custom_select_card mp_profile_iframe" data-pluginname="mp-common-profile" data-nickname="' +
        escapeAttr(item.nickname || item.name || '') + '" data-from="0" data-headimg="' + escapeAttr(headimg) +
        '" data-signature="' + escapeAttr(item.signature || '') + '" data-id="' + escapeAttr(id) +
        '" data-service_type="' + escapeAttr(item.service_type || '2') + '"></mp-common-profile>';
    }
    return item.alias
      ? '<mpprofile class="js_uneditable custom_select_card mp_profile_iframe" data-pluginname="mpprofile" data-alias="' + escapeAttr(item.alias) + '" data-from="0"></mpprofile>'
      : '<!-- 公众号名片配置不完整: ' + escapeHtml(key) + ' -->';
  }
  if (type === 'miniprogram') {
    const item = miniprograms[key];
    if (!item) return '<!-- 未找到小程序配置: ' + escapeHtml(key) + ' -->';
    if (item.applink) {
      const title = item.link_text || item.title || key;
      return '<span leaf=""><a class="weapp_text_link js_weapp_entry" style="font-size: 17px;" data-miniprogram-type="text" data-miniprogram-appid="' +
        escapeAttr(item.appid || '') + '" data-miniprogram-path="' + escapeAttr(item.path || 'pages/index/index') +
        '" data-miniprogram-nickname="' + escapeAttr(item.miniprogram_nickname || item.nickname || item.title || key) +
        '" data-miniprogram-servicetype="' + escapeAttr(item.servicetype || item.service_type || '0') +
        '" data-miniprogram-applink="' + escapeAttr(item.applink) + '">' + escapeHtml(title) + '</a></span>';
    }
    return '<mp-miniprogram data-miniprogram-appid="' + escapeAttr(item.appid || '') + '" data-miniprogram-path="' +
      escapeAttr(item.path || 'pages/index/index') + '" data-miniprogram-title="' + escapeAttr(item.title || key) +
      '" data-miniprogram-imageurl="' + escapeAttr(item.image || '') + '"></mp-miniprogram>';
  }
  if (type === 'miniprogram_card') {
    const item = cards[key];
    if (!item) return '<!-- 未找到小程序卡片配置: ' + escapeHtml(key) + ' -->';
    const missing = ['appid', 'avatar', 'imageurl', 'applink'].filter(field => !String(item[field] || '').trim());
    if (missing.length) return '<!-- mp-common-miniprogram 缺少: ' + missing.join(', ') + ' -->';
    return '<section nodeleaf=""><mp-common-miniprogram class="js_uneditable custom_select_card mp_miniprogram_iframe" data-pluginname="insertminiprogram" data-miniprogram-path="' +
      escapeAttr(item.path || 'pages/index/index') + '" data-miniprogram-nickname="' + escapeAttr(item.miniprogram_nickname || item.nickname || item.title || key) +
      '" data-miniprogram-avatar="' + escapeAttr(item.avatar) + '" data-miniprogram-title="' + escapeAttr(item.card_title || item.title || key) +
      '" data-miniprogram-imageurl="' + escapeAttr(item.imageurl) + '" data-miniprogram-type="card" data-miniprogram-servicetype="' +
      escapeAttr(item.servicetype || item.service_type || '0') + '" data-miniprogram-appid="' + escapeAttr(item.appid) +
      '" data-miniprogram-applink="' + escapeAttr(item.applink) + '"></mp-common-miniprogram></section>';
  }
  if (type === 'link') {
    const item = (embeds.related_articles?.manual || []).find(entry => normalizeEmbedName(entry?.name) === key);
    if (!item) return '<!-- 未找到链接配置: ' + escapeHtml(key) + ' -->';
    let url = String(item.url || '').trim();
    if (!url) return '<!-- 链接缺少 url: ' + escapeHtml(key) + ' -->';
    if (url.startsWith('http://mp.weixin.qq.com')) url = 'https://' + url.slice('http://'.length);
    const safeUrl = safeHref(url);
    if (!safeUrl) return '<!-- 链接地址不安全: ' + escapeHtml(key) + ' -->';
    const text = String(item.name || key);
    return '<span leaf=""><a class="normal_text_link" target="_blank" style="" href="' + escapeAttr(safeUrl) +
      '" textvalue="' + escapeAttr(text) + '" data-itemshowtype="0" linktype="text" data-linktype="2">' + escapeHtml(text) + '</a></span>';
  }
  return '{embed:' + type + ':' + key + '}';
}

export function resolveEmbeds(html, embeds) {
  return String(html || '').replace(/\{embed:(\w+):(.+?)\}/g, (_match, type, name) => replaceEmbed(type, name, embeds));
}

function inlineBasic(text, styles) {
  if (!text) return '';
  const protectedParts = [];
  let value = String(text);
  value = value.replace(/`([^`\n]+)`/g, (_match, code) => {
    protectedParts.push('<code style="' + escapeAttr(styles.code || '') + '">' + escapeHtml(code) + '</code>');
    return '\u0001' + (protectedParts.length - 1) + '\u0001';
  });
  value = escapeHtml(value);
  value = value
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong style="' + escapeAttr(styles.strong || '') + '">$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong style="' + escapeAttr(styles.strong || '') + '">$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em style="' + escapeAttr(styles.em || '') + '">$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em style="' + escapeAttr(styles.em || '') + '">$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return value.replace(/\u0001(\d+)\u0001/g, (_match, index) => protectedParts[Number(index)]);
}

function inlineFormat(text, styles) {
  const protectedParts = [];
  let value = String(text || '');
  value = value.replace(/`([^`\n]+)`/g, (_match, code) => {
    protectedParts.push('<code style="' + escapeAttr(styles.code || '') + '">' + escapeHtml(code) + '</code>');
    return '\u0001' + (protectedParts.length - 1) + '\u0001';
  });
  value = value.replace(/(!?)\[([^\]\n]+)\]\((\S+?)(?:\s+["“'‘](.*?)["”'’])?\)/g, (_match, bang, label, href, title) => {
    const target = safeHref(href, Boolean(bang));
    if (!target) return escapeHtml(label);
    const html = bang
      ? '<img src="' + escapeAttr(target) + '" alt="' + escapeAttr(label) + '"' + (title ? ' title="' + escapeAttr(title) + '"' : '') + ' style="' + escapeAttr(completeImageStyle(styles)) + '" />'
      : '<a href="' + escapeAttr(target) + '" style="' + escapeAttr(styles.a || '') + '"' + (title ? ' title="' + escapeAttr(title) + '"' : '') + '>' + escapeHtml(label) + '</a>';
    protectedParts.push(html);
    return '\u0001' + (protectedParts.length - 1) + '\u0001';
  });
  value = escapeHtml(value);
  value = value
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong style="' + escapeAttr(styles.strong || '') + '">$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong style="' + escapeAttr(styles.strong || '') + '">$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em style="' + escapeAttr(styles.em || '') + '">$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em style="' + escapeAttr(styles.em || '') + '">$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return value
    .replace(/\u0001(\d+)\u0001/g, (_match, index) => protectedParts[Number(index)])
    .replace(/\{embed:(\w+):(.+?)\}/g, match => match);
}

function roman(value) {
  let number = Math.max(0, Math.min(39, value));
  let output = '';
  for (const [amount, symbol] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (number >= amount) {
      output += symbol;
      number -= amount;
    }
  }
  return output || 'I';
}

function cjkNumeral(value) {
  if (!Number.isInteger(value) || value < 1 || value > 99) return String(value);
  const digits = '〇一二三四五六七八九';
  if (value < 10) return digits[value];
  const [tens, ones] = [Math.floor(value / 10), value % 10];
  return (tens === 1 ? '十' : digits[tens] + '十') + (ones ? digits[ones] : '');
}

function renderComponent(spec, arg, bodyLines, styles) {
  const bodyKind = String(spec.body || 'free').trim();
  const tpl = substituteTheme(String(spec.template || ''), styles);
  if (bodyKind === 'rows') {
    const delimiter = String(spec.row_delimiter || '|');
    const rowTemplate = substituteTheme(String(spec.row_template || ''), styles);
    const columns = Number(spec.row_columns || 0) || 2;
    const rowMap = spec.row_map || {};
    const rowMapDefault = spec.row_map_default || {};
    const rows = [];
    for (const line of bodyLines) {
      if (!line.trim()) continue;
      const cells = line.split(delimiter).map(cell => cell.trim());
      while (cells.length < columns) cells.push('');
      const values = [];
      for (let index = 0; index < columns; index += 1) {
        const fallback = rowMapDefault['c' + index];
        const mapped = rowMap['c' + index]?.[cells[index]];
        values.push(mapped ?? (cells[index] || fallback || ''));
      }
      let row = rowTemplate;
      values.forEach((value, index) => { row = row.split('{c' + index + '}').join(inlineBasic(value, styles)); });
      rows.push(row.replaceAll('{n}', String(rows.length + 1)));
    }
    return tpl.replace('{content}', rows.join('')).replaceAll('{arg}', inlineBasic(arg, styles));
  }
  const paragraphs = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    paragraphs.push(inlineFormat(buffer.join(' '), styles));
    buffer = [];
  };
  for (const line of bodyLines) {
    if (!line.trim()) flush();
    else buffer.push(line.trim());
  }
  flush();
  const content = bodyKind === 'single'
    ? inlineFormat(bodyLines.map(line => line.trim()).filter(Boolean).join(' '), styles)
    : paragraphs.length > 1
      ? paragraphs.map(paragraph => '<section style="margin:0 0 0.9em;">' + paragraph + '</section>').join('')
      : paragraphs[0] || '';
  let result = tpl.replace('{content}', content).replaceAll('{arg}', inlineBasic(arg, styles));
  if (result.includes('{arg0}') || result.includes('{arg1}')) {
    const parts = arg.split('/').map(part => part.trim());
    result = result.replaceAll('{arg0}', inlineBasic(parts[0] || '', styles)).replaceAll('{arg1}', inlineBasic(parts[1] || '', styles));
  }
  return result;
}

function setextToAtx(markdown) {
  const lines = markdown.split('\n');
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const next = lines[index + 1]?.trim();
    if (lines[index].trim() && /^={3,}$/.test(next || '')) {
      output.push('# ' + lines[index].trim());
      index += 1;
    } else if (lines[index].trim() && /^-{3,}$/.test(next || '')) {
      output.push('## ' + lines[index].trim());
      index += 1;
    } else {
      output.push(lines[index]);
    }
  }
  return output.join('\n');
}

function resolveReferences(markdown) {
  const definitions = new Map();
  const lines = markdown.split('\n').filter(line => {
    const match = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+["“'‘](.*?)["”'’])?\s*$/);
    if (!match) return true;
    definitions.set(match[1].toLowerCase(), { url: match[2], title: match[3] || '' });
    return false;
  });
  return lines.map(line => line.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label, id) => {
    const item = definitions.get((id || label).toLowerCase());
    return item ? '[' + label + '](' + item.url + (item.title ? ' "' + item.title + '"' : '') + ')' : match;
  })).join('\n');
}

function closeLists(stack, parts) {
  while (stack.length) parts.push('</' + stack.pop() + '>');
}

function renderEmbedsInline(html, embeds) {
  return resolveEmbeds(html, embeds);
}

export function renderMarkdown(markdown, options = {}) {
  const styles = options.styles || {};
  const components = options.components || {};
  const embeds = options.embeds || {};
  const captionStyle = options.captionStyle || '有图注';
  const skipFirstH1 = options.skipFirstH1 !== false;
  const warnings = [];
  let source = preformatMarkdown(resolveReferences(String(markdown || '')));
  source = setextToAtx(source);
  const lines = source.split('\n');
  const parts = [];
  let paragraph = [];
  let fence = null;
  let codeLines = [];
  let quoteLines = [];
  let listStack = [];
  let listIndent = -1;
  let firstH1 = !skipFirstH1;
  let seenSection = false;
  let sectionNo = 0;
  let skipUntil = -1;

  const pStyle = styles.p || `margin:0 0 ${styles['paragraph-spacing'] || '1.5em'}; font-size:${styles['font-size'] || '16px'}; line-height:${styles['line-height'] || '1.8'}; color:${styles['text-color'] || '#333333'};`;
  const flushCode = () => {
    if (!fence) return;
    const preStyle = styles.pre || 'background:#f5f5f5; padding:16px; border-radius:4px; font-size:13px; line-height:1.8; overflow-x:auto; color:#333;';
    parts.push('<pre style="' + escapeAttr(preStyle) + '"><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    fence = null;
    codeLines = [];
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.map((line, index) => index < paragraph.length - 1 && (line.endsWith('  ') || line.endsWith('\\')) ? line.replace(/[\\ ]+$/, '') + '<br/>' : line.trimEnd()).join(' ');
    parts.push('<p style="' + escapeAttr(pStyle) + '">' + renderEmbedsInline(inlineFormat(text, styles), embeds) + '</p>');
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    const whole = quoteLines.map(line => line.trim().replace(/^>\s?/, '')).filter(Boolean).join(' ');
    const isLead = !seenSection;
    if (isLead && components.lead?.template) {
      parts.push(renderComponent(components.lead, '', [whole], styles));
    } else {
      const cardMatch = whole.match(/^(.*?)\s*(?:——|—|--)\s*([^\s—][^—]{0,24})$/);
      if (!isLead && cardMatch?.[1]?.trim() && components['quote-card']?.template) {
        parts.push(renderComponent(components['quote-card'], cardMatch[2].trim(), [cardMatch[1].trim()], styles));
      } else {
        if (components['quote-mark']?.template) parts.push(substituteTheme(components['quote-mark'].template, styles));
        parts.push('<blockquote style="' + escapeAttr(styles.blockquote || '') + '">');
        for (const line of quoteLines) {
          const text = line.trim().replace(/^>\s?/, '');
          if (!text) continue;
          parts.push('<p style="margin:0.3em 0; font-size:' + escapeAttr(styles['font-size'] || '16px') + '; line-height:' + escapeAttr(styles['line-height'] || '1.8') + ';">' + renderEmbedsInline(inlineFormat(text, styles), embeds) + '</p>');
        }
        parts.push('</blockquote>');
      }
    }
    quoteLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (index < skipUntil) continue;
    const rawLine = lines[index];
    const line = rawLine.trim();

    const fenceMark = fenceInfo(line);
    if (fence) {
      if (fenceMark && fenceMark.char === fence.char && fenceMark.length >= fence.length) flushCode();
      else codeLines.push(rawLine);
      continue;
    }
    if (fenceMark) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      fence = fenceMark;
      codeLines = [];
      continue;
    }
    if (!line) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      continue;
    }

    if (quoteLines.length && !line.startsWith('>')) flushQuote();

    if (/^\{embed:\w+:.+\}$/.test(line)) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      parts.push('<p style="' + escapeAttr(pStyle) + '">' + resolveEmbeds(line, embeds) + '</p>');
      continue;
    }

    const directive = line.match(/^:::([A-Za-z0-9_-]+)(?:\[(.*)\])?\s*$/);
    if (directive) {
      let end = -1;
      for (let look = index + 1; look < lines.length; look += 1) {
        if (lines[look].trim() === ':::') {
          end = look;
          break;
        }
      }
      const spec = components[directive[1]];
      if (spec?.template && end >= 0) {
        flushParagraph();
        flushQuote();
        closeLists(listStack, parts);
        parts.push(renderComponent(spec, directive[2] || '', lines.slice(index + 1, end), styles));
        skipUntil = end + 1;
        continue;
      }
      warnings.push(spec ? '组件 :::' + directive[1] + ' 缺少结尾，已按普通文本输出。' : '未知版式组件 :::' + directive[1] + '，已按普通文本输出。');
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      const level = Math.min(heading[1].length, 4);
      if (level >= 2) seenSection = true;
      if (level === 2) sectionNo += 1;
      if (level === 1 && !firstH1) {
        firstH1 = true;
        continue;
      }
      const tag = 'h' + level;
      let rendered = '<' + tag + ' style="' + escapeAttr(styles[tag] || '') + '">' + inlineFormat(heading[2], styles) + '</' + tag + '>';
      const deco = components[tag + '-deco'];
      if (deco?.template) {
        rendered = substituteTheme(deco.template, styles)
          .replaceAll('{n2}', String(sectionNo).padStart(2, '0'))
          .replaceAll('{nr}', roman(sectionNo))
          .replaceAll('{nz}', cjkNumeral(sectionNo))
          .replaceAll('{n}', String(sectionNo))
          .replace('{content}', rendered);
      }
      parts.push(rendered);
      continue;
    }

    if (/^ {0,3}((-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})$/.test(line)) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      parts.push(components['hr-deco']?.template ? substituteTheme(components['hr-deco'].template, styles) : '<hr style="' + escapeAttr(styles.hr || '') + '" />');
      continue;
    }

    if (/^\|.+\|$/.test(line)) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      const tableLines = [line];
      let look = index + 1;
      while (look < lines.length && /^\|.+\|$/.test(lines[look].trim())) {
        tableLines.push(lines[look].trim());
        look += 1;
      }
      const rows = tableLines.map(row => row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
      const dataRows = rows.filter(row => !row.every(cell => /^:?-+:?$/.test(cell)));
      if (dataRows.length) {
        let table = '<table style="' + escapeAttr(styles.table || '') + '">';
        for (const [rowIndex, row] of dataRows.entries()) {
          table += '<tr>';
          for (const cell of row) {
            const tag = rowIndex === 0 ? 'th' : 'td';
            table += '<' + tag + ' style="' + escapeAttr(styles[tag] || '') + '">' + inlineFormat(cell, styles) + '</' + tag + '>';
          }
          table += '</tr>';
        }
        table += '</table>';
        parts.push(table);
      }
      index = look - 1;
      continue;
    }

    const image = line.match(/^!\[(.*?)\]\(\s*(\S+?)(?:\s+["“'‘](.*?)["”'’])?\s*\)$/);
    if (image) {
      flushParagraph();
      flushQuote();
      closeLists(listStack, parts);
      const alt = image[1];
      const src = image[2];
      const safeSource = safeHref(src, true);
      if (!safeSource) {
        warnings.push('已跳过不安全的图片地址：' + src.slice(0, 80));
        continue;
      }
      const caption = (image[3] || '').trim();
      const cover = isCoverImageAlt(alt);
      if (cover && /^placeholder(?:-|$)/i.test(src)) continue;
      const imageStyle = completeImageStyle(styles);
      let imageHtml = '<p style="text-align:center; margin:1.5em 0;"><img src="' + escapeAttr(safeSource) + '"' + imageDims(safeSource) +
        ' alt="' + escapeAttr(alt) + '" style="' + escapeAttr(imageStyle) + '" /></p>';
      if (components['img-deco']?.template) imageHtml = substituteTheme(components['img-deco'].template, styles).replace('{content}', imageHtml);
      parts.push(imageHtml);
      if (caption && wantCaption(alt, captionStyle)) {
        parts.push('<p style="' + escapeAttr(styles.figcaption || 'text-align:center; font-size:14px; color:' + (styles['text-muted'] || '#999') + ';') + '">' + escapeHtml(caption) + '</p>');
      }
      continue;
    }

    if (line.startsWith('>')) {
      flushParagraph();
      closeLists(listStack, parts);
      quoteLines.push(line);
      continue;
    }

    const listItem = rawLine.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushQuote();
      const indent = listItem[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(listItem[2]);
      const tag = ordered ? 'ol' : 'ul';
      if (indent > listIndent) {
        parts.push('<' + tag + ' style="' + escapeAttr(styles[tag] || '') + '">');
        listStack.push(tag);
        listIndent = indent;
      } else {
        while (indent < listIndent && listStack.length > 1) {
          parts.push('</' + listStack.pop() + '>');
          listIndent -= 2;
        }
        if (listStack.at(-1) !== tag) {
          if (listStack.length) parts.push('</' + listStack.pop() + '>');
          parts.push('<' + tag + ' style="' + escapeAttr(styles[tag] || '') + '">');
          listStack.push(tag);
        }
      }
      parts.push('<li style="' + escapeAttr(styles.li || '') + '">' + renderEmbedsInline(inlineFormat(listItem[3], styles), embeds) + '</li>');
      continue;
    }

    flushQuote();
    paragraph.push(line);
  }

  flushParagraph();
  flushQuote();
  closeLists(listStack, parts);
  flushCode();
  return { html: parts.join('\n'), warnings };
}

export function renderMarkdownDocument(markdown, options = {}) {
  const rendered = renderMarkdown(markdown, options);
  const styles = options.styles || {};
  return '<section style="font-family:' + escapeAttr(styles['font-family'] || DEFAULT_FONT) + '; font-size:' + escapeAttr(styles['font-size'] || '16px') +
    '; line-height:' + escapeAttr(styles['line-height'] || '1.8') + '; color:' + escapeAttr(styles['text-color'] || '#333333') + '; max-width:100%; overflow-wrap:break-word;">' +
    rendered.html + '</section>';
}

const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
