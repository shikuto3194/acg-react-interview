import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionedImageUrl, applyVersionToCard } from '../imageUrl.js';
import manifest from '../imagesManifest.generated.js';

test('image URLs preserve external images and update old local versions without changing card IDs', () => {
  for (const url of ['data:image/png;base64,AA==','blob:example','https://example.test/a.png']) assert.equal(versionedImageUrl(url),url);
  const key=Object.keys(manifest).find(path=>path.endsWith('.png')) || Object.keys(manifest)[0];
  assert.ok(key,'image inventory must not be empty');
  const first=versionedImageUrl(`images/${key}`);
  assert.equal(versionedImageUrl(`images/${key}?v=old`),first);
  assert.equal(versionedImageUrl(first),first);
  const card={id:17,front:{image:`images/${key}`},back:{image:`images/${key}`}};
  const updated=applyVersionToCard(card);
  assert.equal(updated.id,17);assert.equal(updated.front.image,first);assert.equal(updated.back.image,first);
  assert.equal(card.front.image,`images/${key}`);
});
