import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function defineGlobal(name, value) {
  Object.defineProperty(global, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function setupDom() {
  const html = `<!DOCTYPE html>
    <html>
      <body>
        <button id="profile-anchor" type="button" data-profile-menu-anchor aria-expanded="false">Profile</button>
      </body>
    </html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost',
    runScripts: 'dangerously',
    resources: 'usable',
  });

  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('HTMLElement', dom.window.HTMLElement);
  defineGlobal('Node', dom.window.Node);
  defineGlobal('CustomEvent', dom.window.CustomEvent);
  defineGlobal('navigator', dom.window.navigator);
  return dom;
}

async function flushPromises(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe('shared profile menu', () => {
  let dom;
  let selectProfileSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    dom = setupDom();
    selectProfileSpy = vi.fn(async () => {});
    dom.window.selectProfile = selectProfileSpy;
    defineGlobal('selectProfile', selectProfileSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('opens as a dropdown and delegates switching to the page handler', async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/current') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { user_id: 'u1', name: 'Анна', avatar_seed: '1.png' } }),
        };
      }

      if (url === '/api/users') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            items: [
              { user_id: 'u1', name: 'Анна', avatar_seed: '1.png', has_password: false },
              { user_id: 'u2', name: 'Игорь', avatar_seed: '2.png', has_password: true },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/assets/SharedProfileModal.js'));
    dom.window.openProfileMenu({ currentTarget: dom.window.document.getElementById('profile-anchor') });
    await flushPromises();

    const overlay = dom.window.document.getElementById('sharedProfileMenuOverlay');
    const buttons = dom.window.document.querySelectorAll('[data-profile-switch]');

    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(buttons.length).toBe(2);

    buttons[1].click();
    await flushPromises();

    expect(selectProfileSpy).toHaveBeenCalledWith('u2');
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});
