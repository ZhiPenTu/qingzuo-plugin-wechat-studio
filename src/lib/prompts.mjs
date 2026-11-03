import { mergedConfig } from './config.mjs';
import { STAGE_FILES } from './project.mjs';

export function configContext(config = {}, article = {}) {
  const merged = mergedConfig(config, article);
  return [
    ['账号/领域', merged.article_category],
    ['目标读者', merged.target_reader],
    ['选题方向或禁区', merged.topic_direction],
    ['语气调性', merged.tone],
    ['文章风格', merged.writing_style],
    ['段落偏好', merged.paragraph_preference],
    ['小标题密度', merged.heading_density],
    ['标题风格', merged.title_style],
    ['标题字数上限', merged.title_max_length],
    ['摘要字数', merged.summary_length],
    ['目标字数', merged.target_word_count],
    ['图片来源', merged.image_source],
    ['配图密度', merged.image_density],
    ['图注规则', merged.caption_style],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => '- ' + label + '：' + value)
    .join('\n');
}

export function buildTopicPrompt(config = {}, article = {}, input = {}) {
  const merged = mergedConfig(config, article);
  const direction = String(input.topic || merged.topic_direction || '').trim();
  return {
    system: [
      '你是资深微信公众号选题编辑。',
      '先判断用户是否已经给出明确方向；方向足够明确时直接调研，不再盘问。',
      '调研必须优先使用用户已授权的 MCP 搜索与网页读取工具。默认执行 4–6 次搜索、深度读取 2–3 篇资料，并记录来源 URL。',
      '不得静默改用插件内置搜索或其它网络服务。没有可用工具时，明确说明无法联网，允许用户跳过调研或手工提供资料。',
      '输出 3–5 个选题卡。每张卡包含：标题候选 3–5 个、类型（热点/常青/系列）、切入角度、大纲预览、工作量、摘要候选、来源 URL。',
      '不要编造来源，不要把未读到的内容当证据。',
      '',
      configContext(config, article),
      merged.writing_style ? '- 账号风格：' + merged.writing_style : '',
    ].filter(Boolean).join('\n'),
    user: [
      '为本账号策划选题。',
      direction ? '方向或既定话题：' + direction : '账号暂无明确方向，请先基于账号定位收敛方向再给选题。',
      input.series ? '这是系列策划，请同时给出系列总线与每篇顺序、依赖关系。' : '',
      '输出纯 Markdown，遵循上游选题卡模板。',
    ].filter(Boolean).join('\n\n'),
  };
}

export function buildResearchPrompt(config = {}, article = {}, topic = '') {
  return {
    system: [
      '你是公众号资料研究员。',
      '只能使用用户已授权的 MCP 只读搜索和网页读取工具；没有工具时不得虚构调研结果。',
      '默认搜索 4–6 次，深读 2–3 篇资料。记录标题、来源域名、URL、发布时间、可用事实与争议点。',
      '只提取能支撑选题与正文的事实，不复制整篇文章。',
      configContext(config, article),
    ].filter(Boolean).join('\n'),
    user: '为以下选题整理 research.md：\n\n' + topic,
  };
}

export function buildWritingPrompt(config = {}, article = {}, options = {}) {
  const merged = mergedConfig(config, article);
  const mode = options.mode || 'draft';
  const forbidden = [...(merged.forbidden_words || []), ...(merged.forbidden_title_phrases || [])];
  const closingBlock = String(options.closingBlock ?? merged.closing_block ?? '').trim();
  const system = [
    '你是一位资深的微信公众号内容创作者。请严格按以下要求写文章。',
    '',
    '## 基本要求',
    configContext(config, article),
    forbidden.length ? '- 禁用词：' + forbidden.join('、') : '',
    closingBlock ? '- 文末区块：\n' + closingBlock : '',
    merged.original_attribution ? '- 原创标注只作为发布元数据，不写进正文。' : '',
    '',
    '## 输出硬性配额',
    '- 直接以「# 」标题开头，不写新闻电头、作者署名或解释。',
    '- 紧跟标题写一个「> 」引用块作为正文导语，长度 ' + merged.summary_length + ' 字；导语不得与摘要字段逐字重复。',
    '- 用「## 」分节。短段，适合手机阅读。',
    '- 每 100 字左右至少一个加粗落点；把全文加粗按顺序连读，应是一份能独立看懂的缩写版。',
    '- 三项以上并列写成「- **标签**：说明」。',
    '- 全文恰好一处金句：`> 金句。 —— 出处`，出处不超过 25 个字符。',
    '- 加粗只用 **加粗**；小标题只用 ## / ###；链接写成 [锚文本](https://…)；不要输出 HTML 或 ::: 自定义块。',
    '- 原创标注、作者、摘要是发布元数据，正文里不要电头。',
    '',
    '## 配图标记',
    '- 图片来源为 generated 时，正文配图必须使用 `![类型：画面内容](placeholder)`，类型只能是 封面、实证、信息图、氛围。',
    '- 配图密度：' + merged.image_density + '。每节按密度配额写，写完后自己数一遍。',
    '- 封面标记放在标题之前；每个图位独占一行，前后空行。',
    '- 实证类只能要求真实截图/实拍，不得虚构。',
    merged.image_source === 'user' ? '- 本篇使用用户供图，只能引用用户提供的文件名，不得生成新占位符。' : '',
    '',
    options.writingSpec ? '## 用户写作规范\n\n' + options.writingSpec : '',
    options.references?.length ? '## 参考资料库\n\n' + options.references.join('\n\n---\n\n') : '',
    options.references?.length ? '凡实际依据参考资料处，句末用一对中文全角括号标注：（资料路径：`仓库相对路径`）。路径必须与资料条目逐字一致。' : '',
  ].filter(item => item !== undefined && item !== null).join('\n');
  const task = mode === 'rewrite'
    ? '请改写以下文章' + (options.instruction ? '，要求：' + options.instruction : '') + '：\n\n---\n\n' + options.source
    : mode === 'continue'
      ? '以下文章尚未完成，请从断点处继续写完，保持结构和风格一致：\n\n' + options.source
      : mode === 'new'
        ? '请围绕以下主题新写一篇完整公众号文章：\n\n' + String(options.topic || '').trim()
        : '请根据以下选题卡和调研资料写一篇完整公众号文章：\n\n' + String(options.topicCard || options.topic || '').trim() + (options.research ? '\n\n调研资料：\n' + options.research : '');
  return { system, user: task };
}

export function buildReviewPrompt(config = {}, article = {}, markdown = '') {
  const merged = mergedConfig(config, article);
  return {
    system: [
      '你是公众号内容审稿编辑。只诊断，不擅自代改。',
      '把问题分成：阻断、警告、建议。',
      '检查敏感词、错别字、链接、原创标注、写作规范和 AI 味 15 类指纹。',
      'AI 味只作为建议，不阻断定稿。每条都引用原句，并给出可执行的修改方向。',
      '写作规范：' + JSON.stringify(merged.review_required || []),
      '禁用词：' + [...(merged.forbidden_words || []), ...(merged.custom_sensitive_words || [])].join('、'),
    ].join('\n'),
    user: '审阅以下文章，并按分块详细格式输出：\n\n' + String(markdown || ''),
  };
}

export function buildImagePrompt(plan, item = {}) {
  return [
    plan?.title ? '文章标题：' + plan.title : '',
    plan?.medium ? '本篇统一媒介：' + plan.medium : '',
    item.prompt || '',
    '中文画面文字必须是可读的现代简体中文，不要出现 emoji、英文标签或多余说明。',
  ].filter(Boolean).join('\n\n');
}

export function buildStickerPrompt(config = {}, options = {}) {
  const count = Math.max(1, Math.min(9, Number(options.count) || config.multi_image_count || 6));
  return {
    system: [
      '你是公众号贴图策划。先给出整组图方案，再逐图配文。',
      '一组图必须统一风格与媒介，但每张内容不同、顺序有叙事关系。',
      '输出 JSON：{"title":"...","style":"...","images":[{"prompt":"...","caption":"..."}]}',
      '图片数量固定为 ' + count + '，不要输出 Markdown 代码围栏。',
    ].join('\n'),
    user: '主题：' + String(options.topic || '') + '\n内容方向：' + String(config.topic_direction || '') + '\n请给整组方案与逐图配文。',
  };
}

export function stagePrompt(stage, config, article, options = {}) {
  if (stage === 'topic' || stage === 'series') return buildTopicPrompt(config, article, options);
  if (stage === 'research') return buildResearchPrompt(config, article, options.topic);
  if (stage === 'writing') return buildWritingPrompt(config, article, options);
  if (stage === 'review') return buildReviewPrompt(config, article, options.markdown);
  if (stage === 'format') return { system: '你是排版检查员。', user: options.markdown || '' };
  if (stage === 'images') return { system: '你是图片策划。', user: JSON.stringify(options.plan || {}) };
  return { system: '', user: '' };
}

export { STAGE_FILES };
