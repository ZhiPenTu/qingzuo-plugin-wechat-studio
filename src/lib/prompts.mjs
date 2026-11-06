import { mergedConfig } from './config.mjs';
import { STAGE_FILES } from './project.mjs';
import { normalizeStickerLanguage, stickerLanguageInstruction } from './stickers.mjs';

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
    ['摘要写法', merged.summary_guidance],
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
    '- 每个图位说明必须从本节正文提炼：写出具体对象、动作、关系或数字，不能只写“数据、流程、场景、趋势、产品”这类通用词。',
    '- 封面标记必须同时扣住标题和导语主旨；正文图位必须能直接在同节段落中找到依据。',
    '- 不得为了配图虚构正文中没有的事实、步骤、数字或案例。',
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

export function buildReviewPrompt(config = {}, article = {}, markdown = '', options = {}) {
  const merged = mergedConfig(config, article);
  const localIssues = Array.isArray(options.localIssues)
    ? options.localIssues.map(item => String(item || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    system: [
      '你是公众号内容审稿编辑，只做补充诊断，不代写正文。',
      '本地已覆盖敏感词、错别字、链接、原创标注、写作规范和 AI 味；不要重复本地已列出的问题。',
      '只补充最多 5 条最有价值的实质问题，按阻断、警告、建议分组。',
      'AI 补充意见只作提示，不改变本地阻断统计；每条引用原句（不超过 30 字）并给出可直接执行的修改方向。',
      '总输出不超过 800 字，不要输出推理过程。',
      '不要输出总标题，直接从阻断、警告、建议分组开始。',
      '重点检查事实表述、数据归属、逻辑漏洞、平台合规和标题风险。',
      merged.review_required?.length ? '写作规范：' + JSON.stringify(merged.review_required) : '',
      [...(merged.forbidden_words || []), ...(merged.custom_sensitive_words || [])].length
        ? '禁用词：' + [...(merged.forbidden_words || []), ...(merged.custom_sensitive_words || [])].join('、')
        : '',
    ].filter(Boolean).join('\n'),
    user: [
      localIssues.length
        ? '本地已发现问题：\n' + localIssues.map(item => '- ' + item).join('\n')
        : '本地未发现规则级问题。',
      '请审阅以下文章，只补充新的实质问题：\n\n' + String(markdown || ''),
    ].join('\n\n'),
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
  const language = normalizeStickerLanguage(options.language || config.sticker_language);
  const style = String(options.style || config.custom_sticker_style?.[0] || config.default_sticker_style?.[0] || '统一手绘').trim();
  const medium = String(options.medium || '').trim();
  const direction = String(options.direction || config.topic_direction || '').trim();
  const context = configContext(config, {});
  return {
    system: [
      '你是资深公众号贴图策划与视觉编辑，按“先方案、后生图”的顺序工作。',
      '',
      '## 先定整组方案',
      '- 从场景故事 / 知识卡片 / 产品展示 / 节日祝福 / 投票互动中选定一个贴图类型。',
      '- 从场景递进 / 知识点递进 / 并列展示 / 对比 / 悬念揭晓中选定一条叙事线。',
      '- 全组只用一个视觉形态，但每张必须承载不同观点；观点之间要有递进、并列或对比关系。',
      '- 第 1 张负责封面或总起，最后一张负责收束或行动。',
      '',
      '## 每张图的硬性要求',
      '- viewpoint 是这张图的方案小结：一句独立、具体、可复述的观点，不能所有张都等于主题名。',
      '- caption 是配文：补充画面之外的判断、信息或行动，不能复述画面，不能所有张相同。',
      '- prompt 是画面提示词：必须写出这张独有的主体、场景、动作、构图、光线和可见文字。',
      '- 禁止使用“统一风格贴图第 N 张”“画面只承载一个清楚的小观点”这类模板句；每张都要有具体内容。',
      '- 如果选择“无文字”，prompt 不得要求任何文字、字母或数字标签；caption 仍使用简体中文。',
      '',
      '## 输出格式',
      '只输出一个 JSON 对象，不要 Markdown 围栏或解释：',
      '{"title":"≤64字标题","type":"贴图类型","narrative":"叙事线说明","summary":"整组主旨，40–100字","images":[{"viewpoint":"本张观点","prompt":"画面提示词","caption":"配文"}]}',
      'images 固定 ' + count + ' 项，顺序就是发布顺序。',
      '',
      '## 本篇统一约束',
      '- 统一风格：' + style,
      medium ? '- 统一媒介：' + medium : '',
      '- 整组统一主题语言：' + language + '。' + stickerLanguageInstruction(language),
      context ? '\n## 账号配置\n' + context : '',
    ].filter(Boolean).join('\n'),
    user: [
      '主题：' + String(options.topic || ''),
      direction ? '内容方向：' + direction : '',
      '统一风格：' + style,
      medium ? '统一媒介：' + medium : '',
      '统一主题语言：' + language,
      '请先给出整组方案，再给 ' + count + ' 张互不重复的逐图观点、画面提示词和配文。',
    ].filter(Boolean).join('\n'),
  };
}

export function stagePrompt(stage, config, article, options = {}) {
  if (stage === 'topic' || stage === 'series') return buildTopicPrompt(config, article, options);
  if (stage === 'research') return buildResearchPrompt(config, article, options.topic);
  if (stage === 'writing') return buildWritingPrompt(config, article, options);
  if (stage === 'review') return buildReviewPrompt(config, article, options.markdown, options);
  if (stage === 'format') return { system: '你是排版检查员。', user: options.markdown || '' };
  if (stage === 'images') return { system: '你是图片策划。', user: JSON.stringify(options.plan || {}) };
  return { system: '', user: '' };
}

export { STAGE_FILES };
