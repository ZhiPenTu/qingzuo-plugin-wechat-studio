import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  extractImageSlots,
  isCoverImageAlt,
  preformatMarkdown,
  renderMarkdown,
  renderMarkdownDocument,
  resolveEmbeds,
  wantCaption,
} from '../src/lib/markdown.mjs';
import { buildStyles } from '../src/lib/styles.mjs';
import { applyScheme } from '../src/lib/styles.mjs';
import { BUILTIN_THEMES } from '../src/presets-node.mjs';

test('links and images render as HTML rather than escaped text', () => {
  const result = renderMarkdown('欢迎访问[示例](https://example.com "标题")。\n\n![信息图：流程](imgs/a.png "图注")', {
    styles: {},
    captionStyle: '有图注',
  });
  assert.match(result.html, /<a href="https:\/\/example.com" style=""/);
  assert.doesNotMatch(result.html, /&lt;a/);
  assert.match(result.html, /<img src="imgs\/a.png"/);
  assert.match(result.html, /图注/);
});

test('unsafe link and image protocols are rejected', () => {
  const result = renderMarkdown('[危险](javascript:alert(1))\n\n![x](data:text/html;base64,abc)', { styles: {} });
  assert.doesNotMatch(result.html, /javascript:/);
  assert.doesNotMatch(result.html, /data:text/);
  const networkPath = renderMarkdown('[外部](//evil.example/a)\n\n![x](//evil.example/a.png)\n\n[越界](../secret.md)', { styles: {} });
  assert.doesNotMatch(networkPath.html, /evil\.example/);
  assert.doesNotMatch(networkPath.html, /secret\.md/);
});

test('cover detection uses the image type instead of any 封面 mention', () => {
  assert.equal(isCoverImageAlt('封面：配置台'), true);
  assert.equal(isCoverImageAlt('cover: 配置台'), true);
  assert.equal(isCoverImageAlt('Cover：配置台'), true);
  assert.equal(isCoverImageAlt('信息图：封面区域布局'), false);
  assert.equal(isCoverImageAlt('coverage: product launch'), false);

  const result = renderMarkdown('![信息图：封面区域布局](imgs/body-01.jpg)', { styles: {} });
  assert.match(result.html, /<img src="imgs\/body-01.jpg"/);
});

test('cover images join the article body once a real image is available', () => {
  const rendered = renderMarkdown('![封面：配置台](cover.jpg)\n\n图注：封面说明', { styles: {} });
  assert.match(rendered.html, /<img src="cover\.jpg"/);
  assert.match(rendered.html, /封面说明/);
  const themed = renderMarkdown('![封面：配置台](cover.jpg)', { styles: { img: 'aspect-ratio:16/9;' } });
  assert.match(themed.html, /aspect-ratio:auto/);

  const placeholder = renderMarkdown('![封面：配置台](placeholder)\n\n图注：稍后补图', { styles: {} });
  assert.doesNotMatch(placeholder.html, /<img/);
  assert.match(placeholder.html, /稍后补图/);
});

test('body images override theme crops and keep the complete frame', () => {
  const rendered = renderMarkdown('![信息图：完整流程](imgs/body.jpg)', {
    styles: { img: 'width:100%; aspect-ratio:16/9; object-fit:cover;' },
  });
  assert.match(rendered.html, /aspect-ratio:auto/);
  assert.match(rendered.html, /object-fit:contain/);
  assert.match(rendered.html, /height:auto/);

  const inline = renderMarkdown('正文中插入 ![步骤](imgs/inline.jpg) 继续说明。', {
    styles: { img: 'aspect-ratio:16/9; object-fit:cover;' },
  });
  assert.match(inline.html, /<img src="imgs\/inline\.jpg"/);
  assert.match(inline.html, /aspect-ratio:auto/);
  assert.match(inline.html, /object-fit:contain/);
});

test('embed links use the same safe URL policy', () => {
  const embeds = {
    related_articles: { manual: [{ name: '危险', url: '//evil.example/a' }] },
  };
  const result = resolveEmbeds('{embed:link:危险}', embeds);
  assert.match(result, /不安全/);
  assert.doesNotMatch(result, /evil\.example/);
});

test('caption follows none, all and key-image rules', () => {
  assert.equal(wantCaption('信息图：步骤', '无图注'), false);
  assert.equal(wantCaption('氛围：窗边', '有图注'), true);
  assert.equal(wantCaption('信息图：步骤', '关键图有'), true);
  assert.equal(wantCaption('氛围：窗边', '关键图有'), false);
});

test('image slots parse cover, type, source and caption', () => {
  const slots = extractImageSlots('![封面：雾中城市](imgs/cover.jpg)\n![信息图：前后对比](imgs/body.png "图：对比")');
  assert.equal(slots.length, 2);
  assert.equal(slots[0].cover, true);
  assert.equal(slots[1].type, '信息图');
  assert.equal(slots[1].caption, '图：对比');
});

test('fenced code excludes image slots and renders as code', () => {
  const source = '# 标题\n\n~~~md\n![封面：示例](cover.jpg)\n~~~\n\n````md\n```\n![信息图：示例](body.jpg)\n```\n````\n\n![信息图：真实](body-real.jpg)';
  const slots = extractImageSlots(source);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].alt, '信息图：真实');

  const rendered = renderMarkdown(source, { styles: {} });
  assert.equal((rendered.html.match(/<img/g) || []).length, 1);
  assert.match(rendered.html, /body-real\.jpg/);
  assert.match(rendered.html, /<pre/);
  assert.doesNotMatch(rendered.html, /<img src="cover\.jpg"/);
});

test('preformat protects URLs and code while spacing CJK and Latin', () => {
  const text = preformatMarkdown('使用`npm run build`后访问https://example.com/a。');
  assert.match(text, /使用 `npm run build` 后访问 https:\/\/example\.com\/a。/);
});

test('all eight themes build inline styles and three schemes', () => {
  assert.equal(Object.keys(BUILTIN_THEMES).length, 8);
  for (const theme of Object.values(BUILTIN_THEMES)) {
    assert.equal(theme.schemes.length, 3);
    for (const scheme of theme.schemes) {
      const styles = buildStyles(applyScheme(theme, scheme.name));
      assert.ok(styles.h1);
      assert.ok(styles['primary-color']);
      const rendered = renderMarkdownDocument('# 金句标题\n\n> 导语\n\n## 小节\n\n正文 **重点**。', { styles });
      assert.match(rendered, /^<section style="/);
      assert.match(rendered, /导语/);
      assert.match(rendered, /重点/);
    }
  }
});

test('all nine built-in layout components render their YAML examples', () => {
  const directory = path.resolve('src/presets/components');
  const files = readdirSync(directory).filter(name => name.endsWith('.yaml'));
  assert.equal(files.length, 9);
  const components = Object.fromEntries(files.map(name => {
    const value = YAML.parse(readFileSync(path.join(directory, name), 'utf8'));
    return [value.name, value];
  }));
  const styles = buildStyles(BUILTIN_THEMES['亲和']);
  for (const component of Object.values(components)) {
    const result = renderMarkdown(component.example || '', { styles, components, embeds: {} });
    assert.doesNotMatch(result.html, /未知版式组件/);
    assert.equal(result.warnings.filter(item => item.includes('版式组件')).length, 0);
    assert.ok(result.html.length > 40);
  }
});

test('document renderer wraps the article with inline font styles', () => {
  const html = renderMarkdownDocument('# 标题\n\n正文', { styles: buildStyles(BUILTIN_THEMES['亲和']) });
  assert.match(html, /^<section style="/);
  assert.match(html, /<p/);
});

test('unknown embeds stay explicit instead of disappearing', () => {
  assert.equal(resolveEmbeds('{embed:profile:不存在}', {}), '<!-- 未找到公众号名片配置: 不存在 -->');
});
