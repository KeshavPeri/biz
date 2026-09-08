import assert from 'node:assert/strict';
import test from 'node:test';

import { PostCloseContextFence, forPostCloseContext } from '../src/lib/post-close-context-fence.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('rerender hides A private content and rejects delayed A page and download results after switching to B', async () => {
  const contextA = 'deal-a:closed:user-a';
  const contextB = 'deal-b:closed:user-b';

  const pageFence = new PostCloseContextFence();
  pageFence.switchContext(contextA);
  let stateContext = contextA;
  let privateEntries = ['A private content'];
  const page = deferred();
  const pageTicket = pageFence.begin(contextA);
  const mergePage = page.promise.then((entries) => {
    if (pageFence.isCurrent(pageTicket)) privateEntries = [...privateEntries, ...entries];
  });

  // Model the component rerender boundary: invalidation happens during render,
  // while keyed projection hides the previous state before effects can run.
  pageFence.switchContext(contextB);
  assert.deepEqual(forPostCloseContext(contextB, stateContext, privateEntries, []), []);
  stateContext = contextB;
  privateEntries = [];
  page.resolve(['delayed A page']);
  await mergePage;
  assert.deepEqual(privateEntries, []);

  const downloadFence = new PostCloseContextFence();
  downloadFence.switchContext(contextA);
  const download = deferred();
  const downloadTicket = downloadFence.begin(contextA);
  const opened = [];
  const openDownload = download.promise.then((url) => {
    if (downloadFence.isCurrent(downloadTicket)) opened.push(url);
  });
  downloadFence.switchContext(contextB);
  download.resolve('https://fictional.invalid/signed-a.pdf');
  await openDownload;
  assert.deepEqual(opened, []);
});
