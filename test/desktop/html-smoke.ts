import { BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { HtmlHost } from '../../src/host/html.ts';
export async function testHtml() {
  const host = new HtmlHost(() => {});
  try {
    await host.show(
      {
        type: 'html',
        rect: [20, 20, 250, 120],
        html: '<div>测试内容</div><script>document.body.dataset.ran="yes";</script>',
        ttl: 1000,
      },
      { bounds: { x: 0, y: 0, width: 1200, height: 800 } },
    );
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('data:text/html'),
    );
    assert.ok(window, 'isolated HTML window exists');
    const frame = window.webContents.mainFrame.frames[0];
    assert.ok(frame, 'sandboxed srcdoc frame exists');
    assert.equal(await frame.executeJavaScript('document.body.dataset.ran'), 'yes');
    assert.equal(await frame.executeJavaScript('typeof require'), 'undefined');
    assert.equal(await frame.executeJavaScript('typeof window.companion'), 'undefined');
    assert.equal(
      await frame.executeJavaScript('try { parent.document.body; "allowed" } catch { "blocked" }'),
      'blocked',
    );
    assert.equal(
      await frame.executeJavaScript(
        'fetch("http://127.0.0.1:9/").then(()=>"allowed").catch(()=>"blocked")',
      ),
      'blocked',
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(window.isDestroyed(), true);
    return [
      'isolated HTML runs inline scripts',
      'HTML has no Node/preload/parent access',
      'HTML network blocked',
      'HTML TTL destroys renderer',
    ];
  } finally {
    host.clear();
  }
}
