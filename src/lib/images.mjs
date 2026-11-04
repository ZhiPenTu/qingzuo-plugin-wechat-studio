import { extractImageSlots } from './markdown.mjs';
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
  '2.35:1': { width: 900, height: 383 },
  '16:9': { width: 1080, height: 608 },
  '1:1': { width: 1080, height: 1080 },
  '1.91:1': { width: 900, height: 471 },
};

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

function coverDescription(style, title, config) {
  const hook = coverCopy(title);
  const common = '请直接生成一张微信公众号信息流封面。不要出现机器人、发光大脑、电路脑、机械手、灯泡或二进制雨。';
  const specs = {
    信息表: '用清晰的表格或三栏信息卡呈现主题，中文标题「' + hook + '」，主体占画面三分之二，文字可读。',
    对比式: '左右并置同一对象的前后两种状态，用相同构图只改变状态，中文短句「' + hook + '」，对比明确。',
    菜品特写: '一道具体菜品的近景特写，真实食物质感，侧逆光，画面默认不加字。',
    数字冲击: '把一个与主题相关的核心数字放到画面最大层级，中文标题「' + hook + '」，数字与文字占七成。',
    截图标注: '一个真实可读的工作界面局部，红圈和箭头指出关键区域，中文短标签「' + hook + '」。',
    扁平插画: '手绘扁平插画，用一张具体隐喻解释主题，柔和纸张纹理，右侧或底部放短钩子「' + hook + '」。',
    图上压字: '一张有空间层次的真实场景照片，左侧压上粗体中文「' + hook + '」，深底浅字。',
    场景实拍: '具体生活或工作场景实拍，有可见的环境细节与自然光，默认不加字。',
    纯色大字: '纯色纸张感背景，只放粗体中文「' + hook + '」，字高占画面三成，最多两个辅助几何元素。',
    人物出镜: '一位真实人物在自然环境中工作或思考，半身构图，环境有叙事细节，默认不加字。',
    产品实拍: '单一产品放在真实台面上，柔和侧光，材质清楚，除产品外最多一个辅助物件。',
    剧照氛围: '像电影剧照一样的单一场景，强方向光、空气感与留白，默认不加字。',
  };
  return common + '\n' + specs[style] + '\n风格：' + (config.cover_style || '简约') + '。画面元素不超过 3 个。';
}

function bodyDescription(style, slot, medium) {
  const content = slot.description || slot.alt;
  const base = '正文配图，16:9。必须使用文章里的真实内容，不得自行编造步骤、数字或结论。' +
    '媒介：' + medium + '。' + MEDIA_DESCRIPTIONS[medium] + '。';
  const specs = {
    实证: '保留真实截图或照片的拍摄需求：' + content + '。不得生成伪造证据。',
    流程步骤: '把以下操作顺序画成有方向的流程：' + content + '。步骤之间用清楚箭头连接。',
    结构分层: '把以下结构画成嵌套或层级关系：' + content + '。层级大小要能一眼比较。',
    数据图表: '把以下数据画成可读的图表：' + content + '。所有数字逐字来自正文。',
    对比两栏: '把以下两种方案或前后状态并排画出：' + content + '。保持同一尺度。',
    清单要点: '把以下并列要点排成清楚的检查清单：' + content + '。不要 emoji 和装饰卡片。',
    概念隐喻: '用一个具体、单一、可画出的物件承载这个概念：' + content + '。不要直译成抽象光线。',
    场景还原: '还原一个读者能代入的具体使用场景：' + content + '。不要加说明文字。',
    金句卡片: '只呈现文章中的这句金句：' + content + '。整张画面除这句话和短出处外没有别的文字。',
  };
  return base + '\n' + specs[style] + '\n画面中除上述必要文字外不出现 emoji、英文标签或解释小字。';
}

export function planImages(markdown, config = {}, article = {}) {
  const merged = mergedConfig(config, article);
  const source = String(markdown || '');
  const slots = extractImageSlots(source, { captionStyle: merged.caption_style });
  const coverSlot = slots.find(slot => slot.cover);
  const bodySlots = slots.filter(slot => !slot.cover);
  const title = String(article.title || source.match(/^#\s+(.+)$/m)?.[1] || '').trim();
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
  const coverAspect = String(merged.cover_aspect || '2.35:1');
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
    prompt: coverDescription(COVER_STYLES.includes(coverStyle) ? coverStyle : chooseCoverStyle(title, source), title, config),
    file: 'imgs/cover-raw.png',
    generate: imageSource !== 'user',
  };
  const items = bodySlots.map((slot, index) => {
    const style = imageSource === 'user' ? '实证' : chooseBodyStyle(slot, bodyCandidates);
    return {
      slotIndex: slot.index,
      index,
      alt: slot.alt,
      type: slot.type,
      caption: slot.caption,
      style,
      role: ['流程步骤', '结构分层', '数据图表', '对比两栏', '清单要点', '实证'].includes(style) ? '信息位' : '节奏位',
      generate: imageSource !== 'user' && style !== '实证',
      file: 'imgs/body-' + String(index + 1).padStart(2, '0') + '.png',
      prompt: bodyDescription(style, slot, medium),
    };
  });
  const prompts = [...(cover.generate ? [cover.prompt] : []), ...items.filter(item => item.generate).map(item => item.prompt)];
  return { title, medium, cover, items, prompts, warnings, source, bodySlots };
}

export function rewriteImageMarkers(markdown, plan) {
  let cursor = 0;
  return String(markdown || '').replace(/^!\[(.*?)\]\(\s*(\S+?)(?:\s+["“'‘](.*?)["”'’])?\s*\)$/gm, (line, alt) => {
    if (cursor >= plan.items.length) return line;
    const item = plan.items[cursor];
    if (item.alt !== alt) return line;
    cursor += 1;
    if (!item.generate) return line;
    const caption = item.caption ? ' "' + item.caption.replaceAll('"', '\\"') + '"' : '';
    return '![' + item.alt + '](' + item.file + caption + ')';
  });
}

export function rewriteImageMarkersWithMapping(markdown, plan, mapping = {}) {
  let cursor = 0;
  return String(markdown || '').replace(/^!\[(.*?)\]\(\s*(\S+?)(?:\s+["“'‘](.*?)["”'’])?\s*\)$/gm, (line, alt, _src, caption) => {
    if (cursor >= plan.items.length) return line;
    const item = plan.items[cursor];
    if (item.alt !== alt) return line;
    cursor += 1;
    const path = mapping[item.index];
    if (!path) return line;
    const title = caption ? ' "' + String(caption).replaceAll('"', '\\"') + '"' : '';
    return '![' + alt + '](' + path + title + ')';
  });
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
  return ASPECT_SIZES[aspect] || ASPECT_SIZES['2.35:1'];
}
