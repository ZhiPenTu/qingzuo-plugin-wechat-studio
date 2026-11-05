import { extractImageSlots, isCoverImageAlt, lineCodeFlags } from './markdown.mjs';
import { mergedConfig, normalizePresetList } from './config.mjs';

export const COVER_STYLES = [
  '信息表', '对比式', '菜品特写', '数字冲击', '截图标注', '扁平插画',
  '图上压字', '场景实拍', '纯色大字', '人物出镜', '产品实拍', '剧照氛围',
];

export const BODY_STYLES = [
  '数据图表', '结构分层', '场景还原', '流程步骤', '金句卡片', '清单要点', '对比两栏', '概念隐喻',
];

export const IMAGE_MEDIA = [
  '马克笔白板', '方格笔记本', '便签手写', '黑板粉笔',
  '牛皮纸圆珠笔', '终端等宽', '打印稿批注', '扁平矢量',
];

export const MEDIA_DESCRIPTIONS = {
  马克笔白板: '磁性白板、金属边框、手写行楷、红笔圈注、旧字迹残影，像刚开完会',
  方格笔记本: '米白方格纸、钢笔手绘、墨迹轻微洇开、涂改和红笔波浪线，结构对齐清楚',
  便签手写: '彩色便签贴在木桌上、边缘微微翘起、签字笔字迹，清单感',
  黑板粉笔: '深墨绿黑板、粉笔飞白、旧擦痕和板槽里的粉笔头，课堂讲解感',
  牛皮纸圆珠笔: '牛皮纸折痕、蓝黑圆珠笔、划掉重写和浅咖啡渍，个人笔记感',
  终端等宽: '深色终端窗、等宽字、青色正文与橙色提示行、方块光标，纯色平面',
  打印稿批注: 'A4 印刷体、红笔圈划、页边手写批注与箭头、纸张轻微卷边',
  扁平矢量: '圆角矩形、箭头、低饱和色块，只用于正式产品文档风',
};

export const ASPECT_SIZES = {
  '3:4': { width: 900, height: 1200 },
  '4:3': { width: 1200, height: 900 },
  '2.35:1': { width: 900, height: 383 },
  '16:9': { width: 1080, height: 608 },
  '1:1': { width: 1080, height: 1080 },
  '1.91:1': { width: 900, height: 471 },
};

const ASPECT_LABELS = {
  '3:4': '竖版 3:4',
  '4:3': '横版 4:3',
  '16:9': '横版 16:9',
  '1:1': '方形 1:1',
  '1.91:1': '横版 1.91:1',
  '2.35:1': '宽银幕 2.35:1',
};

const IMAGE_LINE = /^!\[(.*?)\]\(\s*(\S+?)(?:\s+["“'‘](.*?)["”'’])?\s*\)$/;

export function aspectDescription(aspect) {
  const value = ASPECT_SIZES[aspect] ? String(aspect) : '3:4';
  return ASPECT_LABELS[value] + '（宽高比 ' + value + '）';
}

export function compositionSafety(aspect) {
  return '按 ' + aspectDescription(aspect) +
    ' 的完整画布构图，四周至少预留 6% 安全边距；标题、数字、人物、产品、箭头和说明文字必须完整显示，' +
    '不得贴边或被裁切。不要把关键内容放到画面边缘，也不要生成需要二次裁切才能看全的构图。';
}

const COVER_RULES = {
  数字冲击: /^\s*\d|[\d.]+\s*(?:%|万|亿|倍|个)/,
  对比式: /(?:对比|前后|之前|之后|旧|新|方案|评测|区别)/,
  截图标注: /(?:教程|操作|步骤|设置|配置|界面|工具|功能)/,
  信息表: /(?:清单|盘点|指标|价格|参数|数据|报告)/,
  纯色大字: /(?:方法|观点|为什么|如何|真相|误区|指南)/,
  扁平插画: /(?:原理|机制|系统|流程|概念|入门)/,
  人物出镜: /(?:人物|访谈|故事|经历|创始人|作者)/,
  菜品特写: /(?:美食|菜谱|烹饪|食材|餐厅)/,
  场景实拍: /(?:旅行|城市|生活|现场|探店|办公)/,
  产品实拍: /(?:产品|开箱|硬件|设备|新品)/,
  剧照氛围: /(?:电影|剧集|音乐|情绪|夜晚|回忆)/,
  图上压字: /(?:观察|思考|趋势|增长|焦虑|选择|自由|边界)/,
};

const BODY_RULES = {
  '流程步骤': /(?:流程|步骤|先|然后|接着|最后|操作|方法)/,
  '结构分层': /(?:结构|层级|组成|模块|架构|嵌套)/,
  '数据图表': /(?:数据|指标|增长|下降|比例|百分之|%|数字)/,
  '对比两栏': /(?:对比|区别|前后|优劣|方案|取舍)/,
  '清单要点': /(?:清单|要点|检查|列表|建议)/,
  '场景还原': /(?:场景|想象|像在|当你|坐在|走进)/,
  '金句卡片': /(?:金句|记住|一句话|最值得)/,
  '概念隐喻': /.*/,
};

export function chooseCoverStyle(title, text = '') {
  const value = String(title || '') + '\n' + String(text || '').slice(0, 800);
  for (const name of COVER_STYLES) {
    if (COVER_RULES[name]?.test(value)) return name;
  }
  return '纯色大字';
}

export function chooseBodyStyle(slot, candidates = []) {
  const value = String(slot?.description || '') + '\n' + String(slot?.alt || '');
  const automatic = slot?.type === '实证'
    ? '实证'
    : slot?.type === '氛围'
      ? (/金句|一句话/.test(value) ? '金句卡片' : chooseByRules(value))
      : chooseByRules(value);
  const allowed = normalizePresetList(candidates).filter(name => name === '实证' || BODY_STYLES.includes(name));
  if (!allowed.length || allowed.includes(automatic)) return automatic;
  if (slot?.type === '实证') return allowed.includes('实证') ? '实证' : automatic;
  return allowed.find(name => name !== '实证') || automatic;
}

function chooseByRules(value) {
  for (const name of BODY_STYLES) {
    if (BODY_RULES[name]?.test(value)) return name;
  }
  return '概念隐喻';
}

export function chooseMedium(config = {}, article = {}, markdown = '') {
  const chosen = String(article.image_medium || config.image_medium || '').trim();
  if (chosen && IMAGE_MEDIA.includes(chosen)) return chosen;
  const value = String(markdown || '') + '\n' + String(config.article_category || '');
  if (/(?:命令|配置|代码|终端|报错|API|YAML)/i.test(value)) return '终端等宽';
  if (/(?:评测|审稿|拆解|对比|逐条)/.test(value)) return '打印稿批注';
  if (/(?:教程|科普|入门|原理|课堂)/.test(value)) return '黑板粉笔';
  if (/(?:清单|要点|整理|笔记)/.test(value)) return '便签手写';
  if (/(?:随笔|个人|经历|心得)/.test(value)) return '牛皮纸圆珠笔';
  if (/(?:结构|层级|图表|对齐)/.test(value)) return '方格笔记本';
  if (config.tone === '正式严谨') return '扁平矢量';
  return '马克笔白板';
}

function clipPromptText(value, limit = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if ([...text].length <= limit) return text;
  const head = [...text].slice(0, Math.max(1, limit - 1)).join('');
  const boundary = Math.max(...['。', '！', '？', '；', '，', '、'].map(mark => head.lastIndexOf(mark)));
  if (boundary >= Math.floor(limit * 0.55)) return head.slice(0, boundary + 1).trim() + '…';
  const safe = head
    .replace(/[0-9０-９.]+(?:\s*(?:%|％|万|亿|倍|元|小时|分钟|天|个|家|座|公里|米))?\s*$/, '')
    .trim();
  return (safe || head).replace(/[，。；、：,.;:\s]+$/, '') + '…';
}

function joinPromptFacts(values, separator = '；') {
  return (Array.isArray(values) ? values : [])
    .map(value => String(value || '').replace(/[，。；、,.;\s]+$/, '').trim())
    .filter(Boolean)
    .join(separator);
}

function promptText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/（资料路径[:：][^）]*）/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptSentences(value) {
  return String(value || '')
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map(promptText)
    .filter(Boolean);
}

function parseArticleBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const flags = lineCodeFlags(lines);
  const blocks = [];
  let paragraph = [];
  let paragraphLine = 0;
  let tableRows = [];
  let tableLine = 0;
  let listRegion = false;
  const flush = () => {
    const raw = paragraph.join(' ');
    const text = promptText(raw);
    if (text) blocks.push({ kind: 'paragraph', lineIndex: paragraphLine, text, strong: /\*\*[^*\n]+\*\*/.test(raw) });
    paragraph = [];
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    const header = tableRows[0];
    const rows = tableRows.slice(1);
    const text = rows.length
      ? rows.map(row => row.map((cell, index) => (header[index] || '列 ' + (index + 1)) + '：' + cell).join('，')).join('；')
      : header.join('，');
    blocks.push({ kind: 'table', lineIndex: tableLine, text: promptText(text) });
    tableRows = [];
  };
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (flags[lineIndex] || !line) {
      flush();
      flushTable();
      continue;
    }
    const indent = rawLine.startsWith('\t') ? 4 : rawLine.match(/^ */)[0].length;
    const listMarker = /^(?:[-*+]|\d+[.)])\s+/.test(line);
    if (indent >= 4 && !listMarker && (!listRegion || indent >= 8)) {
      flush();
      flushTable();
      continue;
    }
    if (IMAGE_LINE.test(line)) {
      flush();
      flushTable();
      listRegion = false;
      blocks.push({ kind: 'image', lineIndex, text: '' });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      flushTable();
      listRegion = false;
      blocks.push({ kind: 'heading', level: heading[1].length, lineIndex, text: promptText(heading[2]) });
      continue;
    }
    if (line.startsWith('>')) {
      flush();
      flushTable();
      listRegion = false;
      blocks.push({ kind: 'quote', lineIndex, text: promptText(line) });
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      flushTable();
      listRegion = true;
      blocks.push({ kind: 'list', lineIndex, text: promptText(line), strong: /\*\*[^*\n]+\*\*/.test(line) });
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      flush();
      listRegion = false;
      const cells = line.split('|').slice(1, -1).map(cell => promptText(cell));
      if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      if (!tableRows.length) tableLine = lineIndex;
      tableRows.push(cells);
      continue;
    }
    flushTable();
    if (!/^(?:\t| {2,})/.test(rawLine)) listRegion = false;
    if (!paragraph.length) paragraphLine = lineIndex;
    paragraph.push(line);
  }
  flush();
  flushTable();
  return blocks;
}

function sentenceScore(value, strong = false) {
  const text = String(value || '');
  let score = 0;
  if (/[0-9０-９]/.test(text)) score += 4;
  if (/(?:%|％|万|亿|倍|元|小时|分钟|天|个|家|座|公里|米)/.test(text)) score += 1;
  if (/(?:不是|而是|反而|关键|本质|意味着|因为|所以|但|却|从.+到|先.+再|第一|第二)/.test(text)) score += 2;
  if (/(?:直播|镜头|屏幕|桌面|车间|终端|清单|表格|地图|节点|客户|用户|产品|设备|现场)/.test(text)) score += 1;
  if (strong) score += 1;
  if ([...text].length >= 18 && [...text].length <= 110) score += 1;
  if ([...text].length > 130 || [...text].length < 10) score -= 2;
  return score;
}

function rankSentences(blocks, limit = 3) {
  const seen = new Set();
  return blocks
    .filter(block => ['paragraph', 'quote', 'list', 'table'].includes(block.kind))
    .flatMap((block, blockIndex) => promptSentences(block.text).map((text, sentenceIndex) => ({
      text,
      score: sentenceScore(text, block.strong),
      order: blockIndex * 100 + sentenceIndex,
    })))
    .filter(item => {
      const key = item.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .sort((left, right) => left.order - right.order)
    .map(item => clipPromptText(item.text, 120));
}

function numericFacts(values) {
  return values.filter(value => /[0-9０-９]/.test(String(value || '')));
}

function buildArticleBrief(markdown, title, article = {}) {
  const blocks = parseArticleBlocks(markdown);
  const headings = blocks.filter(block => block.kind === 'heading' && block.level >= 2);
  const firstSection = headings[0]?.lineIndex ?? Number.POSITIVE_INFINITY;
  const leadBlock = blocks.find(block => block.kind === 'quote' && block.lineIndex < firstSection)
    || blocks.find(block => block.kind === 'paragraph' && block.lineIndex < firstSection);
  const firstParagraph = blocks.find(block => block.kind === 'paragraph');
  const digest = promptText(article.digest);
  const thesisSource = digest || leadBlock?.text || firstParagraph?.text || '';
  const thesis = clipPromptText(promptSentences(thesisSource)[0] || thesisSource, 110);
  const ranked = rankSentences(blocks, 12);
  const facts = ranked.slice(0, 4);
  const numeric = numericFacts(ranked).slice(0, 3);
  const sections = headings.map(block => clipPromptText(block.text, 36)).filter(Boolean);
  return {
    title: String(title || '').trim(),
    thesis,
    lead: clipPromptText(leadBlock?.text || firstParagraph?.text || '', 130),
    sections: [...new Set(sections)].slice(0, 6),
    facts,
    numericFacts: numeric,
  };
}

function contextForSlot(slot, blocks, brief) {
  const lineIndex = Number.isInteger(slot?.lineIndex) ? slot.lineIndex : -1;
  const previousHeadings = blocks.filter(block => block.kind === 'heading' && block.level >= 2 && block.lineIndex < lineIndex);
  const section = previousHeadings.at(-1) || null;
  const nextHeading = blocks.find(block => block.kind === 'heading' && block.level >= 2 && block.lineIndex > lineIndex);
  const start = section?.lineIndex ?? -1;
  const end = nextHeading?.lineIndex ?? Number.POSITIVE_INFINITY;
  const sectionBlocks = blocks.filter(block => block.lineIndex > start && block.lineIndex < end && block.kind !== 'image');
  const before = sectionBlocks.filter(block => block.lineIndex < lineIndex).slice(-2);
  const after = sectionBlocks.filter(block => block.lineIndex > lineIndex).slice(0, 1);
  const evidence = [...before, ...after]
    .filter(block => ['paragraph', 'quote', 'list', 'table'].includes(block.kind))
    .map(block => block.text)
    .filter(Boolean)
    .join(' / ');
  const ranked = rankSentences(sectionBlocks, 10);
  const facts = ranked.slice(0, 2);
  return {
    section: clipPromptText(section?.text || brief.title, 48),
    evidence: clipPromptText(evidence, 190),
    facts,
    numericFacts: numericFacts(ranked).slice(0, 2),
  };
}

function coverCopy(title) {
  const raw = String(title || '')
    .replace(/[：:｜|—–-].*$/, '')
    .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '')
    .trim();
  if (raw.length <= 7) return raw || '先把这一步做好';
  const clauses = String(title || '').split(/[：:，,。！？?｜|]/).map(item => item.trim()).filter(Boolean);
  const selected = clauses.sort((left, right) => Math.abs(left.length - 6) - Math.abs(right.length - 6))[0] || raw;
  return [...selected].slice(0, 7).join('');
}

function coverDescription(style, title, brief, config, aspect) {
  const hook = coverCopy(title);
  const common = '请直接生成一张微信公众号信息流封面，' + aspectDescription(aspect) + '。不要出现机器人、发光大脑、电路脑、机械手、灯泡或二进制雨。';
  const sections = brief.sections.slice(0, 3).join(' / ');
  const facts = joinPromptFacts(brief.facts.slice(0, 2), ' / ');
  const numericFacts = joinPromptFacts(brief.numericFacts.slice(0, 2), ' / ');
  const thesis = brief.thesis || brief.lead || hook;
  const specs = {
    信息表: '用清晰的表格或三栏信息卡呈现主题，三栏分别落到正文线索：' +
      (sections || '正文的核心论点') + '。中文标题「' + hook + '」，主体占画面三分之二，文字可读。',
    对比式: '左右并置正文中真实存在的两种状态或方案，用相同构图对比：' + thesis +
      '。中文短句「' + hook + '」，两侧对象不能泛化成通用行业图。',
    菜品特写: '一道与正文主题直接相关的具体菜品近景，真实食物质感，侧逆光，画面默认不加字。',
    数字冲击: '把一个核心数字放到画面最大层级。数字只能取正文事实：' +
      (numericFacts || '正文没有明确数字，改用标题短句，禁止编造数字') + '。中文标题「' + hook + '」。',
    截图标注: '一个真实可读的工作界面局部，界面和标注点对应正文场景：' + thesis +
      '。红圈和箭头指出关键区域，中文短标签「' + hook + '」。',
    扁平插画: '手绘扁平插画，用一张具体隐喻解释正文关系：' + thesis +
      '。柔和纸张纹理，右侧或底部放短钩子「' + hook + '」。',
    图上压字: '一张有空间层次的真实场景照片，场景必须对应正文：' + thesis +
      '。左侧压上粗体中文「' + hook + '」，深底浅字。',
    场景实拍: '具体生活或工作场景实拍，场景取自正文：' + thesis + '。有可见的环境细节与自然光，默认不加字。',
    纯色大字: '纯色纸张感背景，只放粗体中文「' + hook + '」，字高占画面三成；辅助信息只能来自章节线索：' +
      (sections || '正文核心论点') + '，最多两个辅助几何元素。',
    人物出镜: '一位真实人物在自然环境中工作或思考，半身构图，人物身份或动作对应正文：' + thesis + '。',
    产品实拍: '单一产品放在真实台面上，柔和侧光，产品必须来自正文线索：' +
      (sections || thesis) + '。除产品外最多一个辅助物件。',
    剧照氛围: '像电影剧照一样的单一场景，强方向光、空气感与留白，场景氛围对应正文：' + thesis + '。',
  };
  const context = [
    title ? '文章标题：' + title : '',
    brief.thesis ? '核心主旨：' + brief.thesis : '',
    sections ? '章节线索：' + sections : '',
    facts ? '关键事实：' + facts : '',
    '封面必须与标题和正文主旨直接对应，不要只做行业通用图。',
  ].filter(Boolean).join('\n');
  return common + '\n' + specs[style] + '\n' + context + '\n风格：' + (config.cover_style || '简约') + '。画面元素不超过 3 个。\n' +
    compositionSafety(aspect);
}

function bodyDescription(style, slot, medium, aspect, context, brief) {
  const content = slot.description || slot.alt;
  const base = '正文配图，' + aspectDescription(aspect) + '。必须使用文章里的真实内容，不得自行编造步骤、数字或结论。' +
    '媒介：' + medium + '。' + MEDIA_DESCRIPTIONS[medium] + '。';
  const evidence = context.evidence || content;
  const numeric = joinPromptFacts(context.numericFacts);
  const articleContext = [
    brief.title ? '文章主题：' + brief.title : '',
    context.section ? '所在章节：' + context.section : '',
    '图位说明：' + content,
    evidence ? '原文依据：' + evidence : '',
  ].filter(Boolean).join('\n');
  const specs = {
    实证: '保留真实截图或照片的拍摄需求：' + content + '。不得生成伪造证据。',
    流程步骤: '把原文中的操作顺序画成有方向的流程：' + content +
      '。步骤必须能从原文依据中找到，不足时减少步骤，不要补写。步骤之间用清楚箭头连接。',
    结构分层: '把原文中的结构画成嵌套或层级关系：' + content +
      '。每层对象来自原文依据，层级大小要能一眼比较。',
    数据图表: '把原文中的数据关系画成可读图表：' + content +
      (numeric
        ? '。数字逐字使用：' + numeric + '，不要补造刻度或趋势。'
        : '。原文没有明确数字时只画关系或数量级，不编造坐标和数字。'),
    对比两栏: '把原文中的两种方案、前后状态或取舍并排画出：' + content +
      '。对比双方和判断标准必须来自原文依据，保持同一尺度。',
    清单要点: '把原文中的并列要点排成清楚的检查清单：' + content +
      '。条目逐字取自原文依据，不要 emoji 和装饰卡片。',
    概念隐喻: '用一个具体、单一、可画出的物件承载原文关系：' + content +
      '。隐喻必须对应原文中的对象和因果关系，不要直译成抽象光线或通用科技图标。',
    场景还原: '还原原文中的具体使用场景：' + content +
      '。人物、地点、设备和动作以原文依据为准，不要加说明文字。',
    金句卡片: '只呈现文章中的这句金句：' + content +
      '。如果图位说明不是完整原句，优先从原文依据中选取完整句子；整张画面除金句和短出处外没有别的文字。',
  };
  return base + '\n' + articleContext + '\n' + specs[style] +
    '\n相关性约束：画面主体、场景、动作、信息关系和数字都必须能追溯到上述文章内容；不要用通用行业图标或装饰性光效替代原文信息。' +
    '\n画面中除上述必要文字外不出现 emoji、英文标签或解释小字。\n' +
    compositionSafety(aspect);
}

export function planImages(markdown, config = {}, article = {}) {
  const merged = mergedConfig(config, article);
  const source = String(markdown || '');
  const slots = extractImageSlots(source, { captionStyle: merged.caption_style });
  const coverSlot = slots.find(slot => slot.cover);
  const bodySlots = slots.filter(slot => !slot.cover);
  const title = String(article.title || source.match(/^#\s+(.+)$/m)?.[1] || '').trim();
  const articleBlocks = parseArticleBlocks(source);
  const brief = buildArticleBrief(source, title, article);
  const coverCandidates = normalizePresetList(
    merged.resolved_cover_image_style?.length
      ? merged.resolved_cover_image_style
      : [merged.custom_cover_image_style, merged.default_cover_image_style].flat(),
  ).filter(name => COVER_STYLES.includes(name));
  const chosenCover = String(article.cover_image_style || '').trim();
  const coverStyle = chosenCover && COVER_STYLES.includes(chosenCover)
    ? chosenCover
    : coverCandidates[0] || chooseCoverStyle(title, source);
  const medium = chooseMedium(merged, article, source);
  const coverAspect = String(merged.cover_aspect || '3:4');
  const bodyAspect = String(merged.article_image_aspect || '3:4');
  const imageSource = String(article.image_source || merged.image_source || 'generated');
  const bodyCandidates = normalizePresetList(
    merged.resolved_article_image_style?.length
      ? merged.resolved_article_image_style
      : [merged.custom_article_image_style, merged.default_article_image_style].flat(),
  );
  const warnings = [];
  if (!coverSlot) warnings.push('正文没有封面标记，将按文章标题生成一张封面。');
  const evidenceCount = bodySlots.filter(slot => slot.type === '实证').length;
  if (evidenceCount) warnings.push(evidenceCount + ' 个实证图位需要你提供真实截图或照片，插件不会伪造。');
  const cover = {
    style: COVER_STYLES.includes(coverStyle) ? coverStyle : chooseCoverStyle(title, source),
    aspect: coverAspect,
    copy: coverCopy(title),
    prompt: coverDescription(
      COVER_STYLES.includes(coverStyle) ? coverStyle : chooseCoverStyle(title, source),
      title,
      brief,
      merged,
      coverAspect,
    ),
    file: 'imgs/cover-raw.png',
    generate: imageSource !== 'user',
  };
  const items = bodySlots.map((slot, index) => {
    const style = imageSource === 'user' ? '实证' : chooseBodyStyle(slot, bodyCandidates);
    const context = contextForSlot(slot, articleBlocks, brief);
    return {
      slotIndex: slot.index,
      index,
      alt: slot.alt,
      src: slot.src,
      type: slot.type,
      caption: slot.caption,
      context,
      style,
      aspect: bodyAspect,
      role: ['流程步骤', '结构分层', '数据图表', '对比两栏', '清单要点', '实证'].includes(style) ? '信息位' : '节奏位',
      generate: imageSource !== 'user' && style !== '实证',
      file: 'imgs/body-' + String(index + 1).padStart(2, '0') + '.png',
      prompt: bodyDescription(style, slot, medium, bodyAspect, context, brief),
    };
  });
  const prompts = [...(cover.generate ? [cover.prompt] : []), ...items.filter(item => item.generate).map(item => item.prompt)];
  return { title, brief, medium, cover, items, prompts, warnings, source, bodySlots };
}

function mapLinesOutsideCode(markdown, transform) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const flags = lineCodeFlags(lines);
  return lines
    .map((line, index) => flags[index] ? line : transform(line))
    .filter(line => line !== null)
    .join('\n');
}

export function rewriteImageMarkers(markdown, plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  let cursor = 0;
  return mapLinesOutsideCode(markdown, line => {
    const match = line.match(IMAGE_LINE);
    if (!match) return line;
    const alt = match[1];
    if (isCoverImageAlt(alt)) return line;
    if (cursor >= items.length) return line;
    const item = items[cursor];
    if (item.alt !== alt) return line;
    cursor += 1;
    if (!item.generate) return line;
    return imageMarker(item.alt, item.file, item.caption);
  });
}

function imageMarker(alt, path, caption) {
  const title = caption ? ' "' + String(caption).replaceAll('"', '\\"') + '"' : '';
  return '![' + alt + '](' + path + title + ')';
}

const CAPTION_LINE = /^\s*(?:图注|图)\s*[:：]/;

function captionAfter(lines, flags, index) {
  let next = index + 1;
  while (next < lines.length && !lines[next].trim()) next += 1;
  return next < lines.length && !flags[next] && CAPTION_LINE.test(lines[next]) ? next : -1;
}

export function rewriteCoverImageMarker(markdown, cover, { insert = false, plan = null, invalid = 'keep' } = {}) {
  const path = String(cover || '').trim();
  const original = String(markdown || '');
  const placeholder = !path;
  if (placeholder && invalid !== 'placeholder') return original;
  const target = path || 'placeholder';
  const source = original.replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const flags = lineCodeFlags(lines);
  const covers = [];
  for (const [index, line] of lines.entries()) {
    if (flags[index]) continue;
    const match = line.match(IMAGE_LINE);
    if (match && isCoverImageAlt(match[1])) covers.push({ index, alt: match[1], caption: match[3] });
  }
  if (!covers.length) {
    if (placeholder || !insert || !source.trim()) return original;
    const alt = plan?.cover?.copy ? '封面：' + plan.cover.copy : '封面';
    return imageMarker(alt, target, '') + '\n\n' + source.replace(/^\n+/, '');
  }
  const first = covers[0];
  const alreadyFirst = lines.slice(0, first.index).every(line => !line.trim());
  const moved = [imageMarker(first.alt, target, first.caption)];
  const remove = new Set();
  for (const item of covers.slice(1)) {
    remove.add(item.index);
    const caption = captionAfter(lines, flags, item.index);
    if (caption >= 0) {
      for (let index = item.index + 1; index <= caption; index += 1) remove.add(index);
    }
  }
  if (alreadyFirst) {
    return lines
      .map((line, index) => index === first.index ? moved[0] : (remove.has(index) ? null : line))
      .filter(line => line !== null)
      .join('\n');
  }
  const caption = captionAfter(lines, flags, first.index);
  if (caption >= 0) {
    moved.push('', lines[caption]);
    for (let index = first.index + 1; index <= caption; index += 1) remove.add(index);
  }
  const rest = lines
    .filter((_line, index) => index !== first.index && !remove.has(index))
    .join('\n')
    .replace(/^\n+/, '');
  return moved.join('\n') + '\n\n' + rest;
}

export function rewriteImageMarkersWithMapping(markdown, plan, mapping = {}, { cover = '', insertCover = true, invalidCover = 'keep' } = {}) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  let cursor = 0;
  const rewritten = mapLinesOutsideCode(markdown, line => {
    const match = line.match(IMAGE_LINE);
    if (!match) return line;
    const alt = match[1];
    if (isCoverImageAlt(alt)) return line;
    if (cursor >= items.length) return line;
    const item = items[cursor];
    if (item.alt !== alt) return line;
    cursor += 1;
    const path = mapping[item.index];
    if (!path) return line;
    return imageMarker(alt, path, match[3]);
  });
  return rewriteCoverImageMarker(rewritten, cover, { insert: insertCover, plan, invalid: invalidCover });
}

export function mapGeneratedFiles(plan, entries) {
  const generated = entries
    .map(entry => ({ ...entry, generatedName: String(entry.name || entry.path || '').split('/').pop() || '' }))
    .filter(entry => entry.kind === 'file' && /^生成图-\d+-ai-[a-f0-9]+-\d+\.(?:png|jpe?g|webp|gif)$/i.test(entry.generatedName))
    .map(entry => ({ ...entry, batchIndex: Number(entry.generatedName.match(/生成图-(\d+)/)?.[1] || 0) }))
    .filter(entry => entry.batchIndex > 0 && entry.batchIndex <= plan.prompts.length)
    .sort((left, right) => left.batchIndex - right.batchIndex);
  return plan.prompts.map((_prompt, index) => generated.find(entry => entry.batchIndex === index + 1) || null).filter(Boolean);
}

export function targetImageSize(aspect) {
  return ASPECT_SIZES[aspect] || ASPECT_SIZES['3:4'];
}
