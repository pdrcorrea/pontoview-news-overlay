/**
 * PontoView shared graphics state engine (no DOM, Supabase, storage or network).
 * Compatible with browsers, Node.js and future Tauri local runtimes.
 * Existing hosted endpoints and transport remain unchanged.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PVGraphicsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));

  // Preserve the legacy merge contract: merge mutates the supplied base,
  // while objects are merged recursively and arrays are replaced.
  function merge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const key of Object.keys(extra)) {
      if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key])) {
        base[key] = merge(base[key] && typeof base[key] === 'object' ? base[key] : {}, extra[key]);
      } else {
        base[key] = extra[key];
      }
    }
    return base;
  }

  function takeState(preview) {
    return clone(preview);
  }

  function outState(program, key) {
    if (!program || !program[key] || typeof program[key] !== 'object' || !('visible' in program[key])) {
      throw new Error('UNKNOWN_GRAPHIC');
    }
    const next = clone(program);
    next[key].visible = false;
    return next;
  }

  function clearState(program, keys) {
    const next = clone(program);
    for (const key of keys) {
      if (next[key] && typeof next[key] === 'object' && 'visible' in next[key]) {
        next[key].visible = false;
      }
    }
    return next;
  }

  // Future local service can persist this state in SQLite and publish its
  // revision over a LAN WebSocket. No I/O happens in this module.
  function createSession(initial) {
    return { preview: clone(initial), program: clone(initial), revision: 0 };
  }

  function requireRevision(session, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || session.revision !== expectedRevision) {
      throw new Error('STATE_CONFLICT');
    }
  }

  function prepare(session, nextPreview, expectedRevision) {
    requireRevision(session, expectedRevision);
    return {
      preview: clone(nextPreview),
      program: clone(session.program),
      revision: session.revision + 1
    };
  }

  function take(session, expectedRevision) {
    requireRevision(session, expectedRevision);
    return {
      preview: clone(session.preview),
      program: takeState(session.preview),
      revision: session.revision + 1
    };
  }

  function out(session, key, expectedRevision) {
    requireRevision(session, expectedRevision);
    return {
      preview: clone(session.preview),
      program: outState(session.program, key),
      revision: session.revision + 1
    };
  }

  function clear(session, keys, expectedRevision) {
    requireRevision(session, expectedRevision);
    return {
      preview: clone(session.preview),
      program: clearState(session.program, keys),
      revision: session.revision + 1
    };
  }

  return Object.freeze({
    clone, merge, takeState, outState, clearState,
    createSession, prepare, take, out, clear
  });
});
