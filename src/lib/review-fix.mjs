import { parseYamlObject } from './config.mjs';
import { saveArticle } from './project.mjs';
import { formatReviewMarkdown, reviewBlockFix } from './review.mjs';

function isMissingError(error) {
  return /ENOENT|no such file|not found|不存在|未找到/i.test(error instanceof Error ? error.message : String(error || ''));
}

export function acceptsBlockFixFinish(reason) {
  const value = String(reason || '').toLowerCase();
  return !value || ['stop', 'complete', 'end_turn'].includes(value);
}

async function readExisting(api, path) {
  try {
    return { exists: true, text: await api.workspace.readText({ path }) };
  } catch (error) {
    if (isMissingError(error)) return { exists: false, text: '' };
    throw error;
  }
}

async function restoreExisting(api, path, snapshot) {
  if (snapshot.exists) {
    await api.workspace.writeText({ path, text: snapshot.text, overwrite: true });
    return;
  }
  await api.workspace.remove({ path, recursive: false }).catch(() => {});
}

export async function applyBlockFix(api, {
  directory,
  source,
  sourcePath,
  articleTitle,
  config,
  content,
}) {
  const latestSource = await readExisting(api, sourcePath);
  if (!latestSource.exists || latestSource.text !== source) {
    return { ok: false, reason: 'stale', remaining: [] };
  }
  const latestArticle = await readExisting(api, directory + '/article.yaml');
  const diskTitle = latestArticle.exists
    ? String(parseYamlObject(latestArticle.text, 'article.yaml').title || '').trim()
    : String(articleTitle || '').trim();
  const fixed = reviewBlockFix(content, config, { title: diskTitle, source: latestSource.text });
  if (!fixed.ok) {
    return {
      ok: false,
      reason: !fixed.preservedImages ? 'images' : !fixed.preservedContent ? 'content' : 'blocked',
      fixed,
      remaining: (fixed.review.issues || []).filter(item => item.level === 'block'),
    };
  }

  const reviewText = formatReviewMarkdown(fixed.review);
  const previousReview = await readExisting(api, directory + '/review.md');
  const stalePaths = [
    ...(sourcePath === directory + '/draft.md'
      ? [directory + '/article.md', directory + '/article.html']
      : [directory + '/article.html']),
    directory + '/img-plan.json',
    directory + '/final-review.md',
    directory + '/publish.json',
  ];
  const previousStale = [];
  for (const path of stalePaths) previousStale.push({ path, ...(await readExisting(api, path)) });
  const beforeWrite = await readExisting(api, sourcePath);
  if (!beforeWrite.exists || beforeWrite.text !== source) {
    return { ok: false, reason: 'stale', remaining: [] };
  }
  const beforeWriteArticle = await readExisting(api, directory + '/article.yaml');
  if (beforeWriteArticle.exists !== latestArticle.exists || beforeWriteArticle.text !== latestArticle.text) {
    return { ok: false, reason: 'stale', remaining: [] };
  }
  let sourceWritten = false;
  let articleWritten = false;
  let reviewWritten = false;
  const invalidated = [];
  try {
    await api.workspace.writeText({ path: sourcePath, text: fixed.markdown, overwrite: true });
    sourceWritten = true;
    if (fixed.needsTitleSync) {
      await saveArticle(api, directory, { title: fixed.title });
      articleWritten = true;
    }
    await api.workspace.writeText({ path: directory + '/review.md', text: reviewText, overwrite: true });
    reviewWritten = true;
    for (const item of previousStale) {
      if (!item.exists) continue;
      await api.workspace.remove({ path: item.path, recursive: false });
      invalidated.push(item);
    }
  } catch (error) {
    const rollbackFailures = [];
    if (sourceWritten) {
      const current = await readExisting(api, sourcePath);
      if (!current.exists || current.text !== fixed.markdown) {
        rollbackFailures.push('正文（检测到并发修改，未覆盖）');
      } else {
        await api.workspace.writeText({ path: sourcePath, text: source, overwrite: true })
          .catch(() => rollbackFailures.push('正文'));
      }
    }
    if (articleWritten) {
      await restoreExisting(api, directory + '/article.yaml', latestArticle)
        .catch(() => rollbackFailures.push('元数据'));
    }
    if (reviewWritten) {
      await restoreExisting(api, directory + '/review.md', previousReview)
        .catch(() => rollbackFailures.push('review.md'));
    }
    for (const item of invalidated) {
      await restoreExisting(api, item.path, item)
        .catch(() => rollbackFailures.push(item.path));
    }
    return { ok: false, reason: 'write', error, rollbackFailures, fixed };
  }
  return { ok: true, fixed, reviewText };
}
