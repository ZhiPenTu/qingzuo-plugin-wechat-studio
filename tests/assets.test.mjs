import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('embedded plugin icon is a complete 512x512 PNG matching the source asset', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const asset = await readFile('assets/icon.png');
  const prefix = 'data:image/png;base64,';
  assert.ok(pkg.commerce.icon.startsWith(prefix));
  const embedded = Buffer.from(pkg.commerce.icon.slice(prefix.length), 'base64');
  assert.deepEqual(embedded, asset);
  assert.deepEqual([...embedded.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(embedded.readUInt32BE(16), 512);
  assert.equal(embedded.readUInt32BE(20), 512);
  let offset = 8;
  while (offset + 12 <= embedded.length) {
    const length = embedded.readUInt32BE(offset);
    const type = embedded.subarray(offset + 4, offset + 8).toString('ascii');
    offset += 12 + length;
    assert.ok(offset <= embedded.length, 'PNG chunk exceeds the icon length');
    if (type === 'IEND') break;
  }
  assert.equal(embedded.subarray(offset - 8, offset - 4).toString('ascii'), 'IEND');
  assert.equal(offset, embedded.length);
});
