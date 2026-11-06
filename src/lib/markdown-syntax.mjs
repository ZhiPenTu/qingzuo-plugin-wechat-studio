export function fenceInfo(line) {
  const match = String(line).match(/^\s*(`{3,}|~{3,})/);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

export function lineCodeFlags(lines) {
  const flags = [];
  let fence = null;
  for (const line of lines) {
    const info = fenceInfo(line);
    if (!fence) {
      if (info) fence = info;
      flags.push(Boolean(info));
      continue;
    }
    flags.push(true);
    if (info && info.char === fence.char && info.length >= fence.length) fence = null;
  }
  return flags;
}

export function fencesBalanced(lines) {
  let fence = null;
  for (const line of lines) {
    const info = fenceInfo(line);
    if (!fence) {
      if (info) fence = info;
    } else if (info && info.char === fence.char && info.length >= fence.length) {
      fence = null;
    }
  }
  return !fence;
}
