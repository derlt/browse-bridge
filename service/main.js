// src/service/main.ts
import http from "node:http";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = ["turn-finished", "turn-failed", "permission-asked", "question-asked"];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_PROVIDER_PATH = "/browser-control";
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_OPEN_TIMEOUT_MS = 45000;
var BROWSER_PROVIDER_ACTION_TIMEOUT_MS = 20000;
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var isBrowserControlAction = (value) => CONTROL_ACTIONS.has(value);
var readContext = (wire) => {
  const directory = wire?.directory;
  const sessionId = wire?.sessionId;
  return {
    directory: String(directory) === directory && directory.length > 0 ? directory : null,
    sessionId: String(sessionId) === sessionId && sessionId.length > 0 ? sessionId : null
  };
};
var readBrowserProviderRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { requestId, action, parameters, context } = wire;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (String(action) !== action || !isBrowserControlAction(action))
    return null;
  if (Object(parameters) !== parameters)
    return null;
  return { requestId, action, parameters, context: readContext(context) };
};
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// src/service/actions.ts
import { createHash, randomBytes } from "node:crypto";

// src/service/pageScripts.ts
var MAX_TEXT_CHARS = 6000;
var MAX_ELEMENTS = 120;
var MAX_LABEL_CHARS = 80;
var MAX_OPTION_COUNT = 32;
var SCROLL_SETTLE_MAX_MS = 100;
var HELPERS = `
  var MAX_ELEMENTS = ${MAX_ELEMENTS};
  var MAX_LABEL_CHARS = ${MAX_LABEL_CHARS};
  var MAX_OPTION_COUNT = ${MAX_OPTION_COUNT};
  var visible = function (element) {
    var rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  var label = function (element) {
    var aria = element.getAttribute('aria-label');
    if (aria) return aria.trim();
    var value = element.getAttribute('value');
    var text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, MAX_LABEL_CHARS);
    if (value) return String(value).slice(0, MAX_LABEL_CHARS);
    var placeholder = element.getAttribute('placeholder');
    return placeholder ? placeholder.trim().slice(0, MAX_LABEL_CHARS) : '';
  };
  var boundedText = function (value) {
    var text = String(value);
    if (text.length <= MAX_LABEL_CHARS) return { value: text, truncated: false };
    var end = MAX_LABEL_CHARS;
    var last = text.charCodeAt(end - 1);
    if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
    return { value: text.slice(0, end), truncated: true };
  };
  var selectOptionLabel = function (option) {
    var explicit = option.getAttribute('label');
    if (explicit !== null) return explicit;
    return String(option.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  var isOptionDisabled = function (element) {
    if (element.disabled === true) return true;
    if (typeof element.matches === 'function' && element.matches(':disabled')) return true;
    var parent = element.parentElement;
    while (parent) {
      if (parent.tagName === 'OPTGROUP' && parent.disabled === true) return true;
      parent = parent.parentElement;
    }
    return false;
  };
  var isUnique = function (selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (error) {
      return false;
    }
  };

  /**
   * Names an element by what it is, falling back to where it sits.
   *
   * A positional chain like 'main > section:nth-of-type(3) > div > a' survives
   * only until the markup shifts, and says nothing about what it points at.
   * Anything the page states about identity — an id, a test id, an accessible
   * name — outlives edits and reads as the thing it selects. The chain remains
   * as the last resort, because something always has to work.
   */
  var cssPath = function (element) {
    var tag = element.tagName.toLowerCase();

    if (element.id) {
      var byId = '#' + CSS.escape(element.id);
      if (isUnique(byId)) return byId;
    }
    var stableAttrs = ['data-testid', 'data-test-id', 'data-test', 'name', 'aria-label'];
    for (var a = 0; a < stableAttrs.length; a += 1) {
      var value = element.getAttribute(stableAttrs[a]);
      if (!value) continue;
      var raw = String(value);
      // A value containing a quote would need escaping for no real gain: such
      // attributes are rare, and the positional chain still covers them.
      if (raw.indexOf('"') !== -1) continue;
      var byAttr = tag + '[' + stableAttrs[a] + '="' + raw + '"]';
      if (isUnique(byAttr)) return byAttr;
    }
    var className = typeof element.className === 'string' ? element.className.trim() : '';
    if (className) {
      var classes = className.split(/\\s+/).filter(Boolean);
      for (var c = 0; c < classes.length; c += 1) {
        var byClass = tag + '.' + CSS.escape(classes[c]);
        if (isUnique(byClass)) return byClass;
      }
    }

    var parts = [];
    var node = element;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var part = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(part); break; }
      var siblings = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      if (node.id) { parts[0] = '#' + CSS.escape(node.id); break; }
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };

  /** What a screen reader would announce, or '' when there is nothing to say. */
  var accessibleName = function (element) {
    var aria = element.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    var labelled = element.getAttribute('aria-labelledby');
    if (labelled) {
      var source = document.getElementById(labelled.split(/\\s+/)[0]);
      if (source && (source.innerText || '').trim()) return source.innerText.trim();
    }
    var title = element.getAttribute('title');
    if (title && title.trim()) return title.trim();
    var alt = element.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    var text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text;
    var value = element.getAttribute('value');
    return value && String(value).trim() ? String(value).trim() : '';
  };
  var findByText = function (needle) {
    var wanted = String(needle).replace(/\\s+/g, ' ').trim().toLowerCase();
    var candidates = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"], summary, label');
    var exact = null;
    var partial = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var element = candidates[i];
      if (!visible(element)) continue;
      var text = label(element).toLowerCase();
      if (!text) continue;
      if (text === wanted) { exact = element; break; }
      if (!partial && text.indexOf(wanted) !== -1) partial = element;
    }
    return exact || partial;
  };
`;
var wrap = (body) => `(() => {
${HELPERS}
${body}
})()`;
var buildSnapshotScript = ({ selector } = {}) => wrap(`
  var scopeSelector = ${JSON.stringify(selector ?? "")};
  var root = document;
  if (scopeSelector) {
    try { root = document.querySelector(scopeSelector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + scopeSelector }; }
    if (!root) return { ok: false, error: 'No element matches ' + scopeSelector };
  }
  var interactive = root.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [contenteditable="true"]');
  var elements = [];
  var visibleTotal = 0;
  for (var i = 0; i < interactive.length; i += 1) {
    var element = interactive[i];
    if (!visible(element)) continue;
    visibleTotal += 1;
    if (elements.length >= MAX_ELEMENTS) continue;

    var rect = element.getBoundingClientRect();
    // Empty and default-valued fields are left out rather than serialized as
    // "" and false. Repeated across a hundred entries that overhead dwarfed
    // the information it carried.
    var entry = {
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
    // The list covers the whole document so anything can be clicked without
    // scrolling to it first, which means bounds alone do not say what is on
    // screen — a negative y reads as a bug otherwise.
    if (rect.bottom > 0 && rect.top < window.innerHeight) entry.inViewport = true;
    var type = element.getAttribute('type');
    if (type) entry.type = type;
    var role = element.getAttribute('role');
    if (role) entry.role = role;
    var labelText = label(element);
    if (labelText) entry.label = labelText;
    if (element.disabled === true) entry.disabled = true;
    if (element.tagName === 'SELECT') {
      entry.multiple = element.multiple === true;
      entry.options = [];
      var optionList = element.options;
      for (var optionIndex = 0; optionIndex < optionList.length && optionIndex < MAX_OPTION_COUNT; optionIndex += 1) {
        var option = optionList[optionIndex];
        var optionLabelText = boundedText(selectOptionLabel(option));
        var optionValueText = boundedText(option.value);
        if (optionLabelText.truncated || optionValueText.truncated) entry.optionsTruncated = true;
        entry.options.push({
          label: optionLabelText.value,
          value: optionValueText.value,
          selected: option.selected === true,
          disabled: isOptionDisabled(option)
        });
      }
      if (optionList.length > MAX_OPTION_COUNT) entry.optionsTruncated = true;
    }
    // Flagged rather than described: reporting the accessible name of every
    // element would cost more than it tells, while its absence on something
    // clickable is a defect worth naming.
    if (!accessibleName(element)) entry.missingAccessibleName = true;
    elements.push(entry);
  }
  // The text follows the scope too: a dialog's snapshot that carried the page
  // under it gave no way to tell which lines were in the dialog.
  var textRoot = root === document ? document.body : root;
  var body = textRoot ? (textRoot.innerText || '') : '';
  var text = body.replace(/\\n{3,}/g, '\\n\\n').trim();
  var docEl = document.documentElement;
  var result = {
    ok: true,
    url: String(location.href),
    title: String(document.title || ''),
    scope: scopeSelector || 'document',
    scrollY: Math.round(window.scrollY),
    maxScrollY: Math.max(0, Math.round(docEl.scrollHeight - window.innerHeight)),
    text: text.slice(0, ${MAX_TEXT_CHARS}),
    elements: elements
  };
  // State what was dropped. A capped list that reports only its own length
  // reads as the whole page, and the agent acts as if it had seen everything.
  if (text.length > ${MAX_TEXT_CHARS}) {
    result.textTruncated = true;
    result.textTotalChars = text.length;
  }
  if (visibleTotal > elements.length) {
    result.elementsTruncated = true;
    result.interactiveElementsOnPage = visibleTotal;
  }
  // browse drops an execute value over 32 KB of UTF-8. Keep the answer under
  // that so a dense page still returns a partial snapshot instead of no
  // snapshot.
  var budget = 28000;
  var size = function () { return new TextEncoder().encode(JSON.stringify(result)).length; };
  while (size() > budget && result.elements.length > 0) {
    result.elements.pop();
    result.elementsTruncated = true;
    result.interactiveElementsOnPage = visibleTotal;
  }
  while (size() > budget && result.text.length > 0) {
    result.text = result.text.slice(0, Math.max(0, result.text.length - 1000));
    result.textTruncated = true;
    result.textTotalChars = text.length;
  }
  return result;
`);
var buildClickScript = ({ selector, text }) => wrap(`
  var selector = ${JSON.stringify(selector ?? "")};
  var text = ${JSON.stringify(text ?? "")};
  var target = null;
  if (selector) {
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
    if (!target) return { ok: false, error: 'No element matches ' + selector };
  } else {
    target = findByText(text);
    if (!target) return { ok: false, error: 'No clickable element has the label ' + text };
  }
  if (target.disabled === true) return { ok: false, error: 'Element is disabled' };
  target.scrollIntoView({ block: 'center', inline: 'center' });

  // A real click is a sequence, and many widgets act on its first half:
  // custom selects open on mousedown or focus and ignore the click itself.
  // Replay what the mouse would send to the middle of the element. The event
  // goes to whatever is drawn there when that sits inside the target, as it
  // would under a real pointer; anything else keeps the target the agent named.
  var rect = target.getBoundingClientRect();
  var x = rect.left + rect.width / 2;
  var y = rect.top + rect.height / 2;
  var drawn = document.elementFromPoint(x, y);
  var hit = drawn && target.contains(drawn) ? drawn : target;
  var fire = function (element, Type, type, extra) {
    var init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: 0, detail: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true
    };
    for (var key in extra) init[key] = extra[key];
    return element.dispatchEvent(new Type(type, init));
  };
  var Pointer = window.PointerEvent || window.MouseEvent;
  var Mouse = window.MouseEvent;
  var notBubbling = { bubbles: false, cancelable: false };

  fire(hit, Pointer, 'pointerover', {});
  fire(hit, Pointer, 'pointerenter', notBubbling);
  fire(hit, Mouse, 'mouseover', {});
  fire(hit, Mouse, 'mouseenter', notBubbling);
  var pointerDown = fire(hit, Pointer, 'pointerdown', { buttons: 1 });
  // A cancelled pointerdown suppresses the mouse events, as in a browser.
  var mouseDown = pointerDown ? fire(hit, Mouse, 'mousedown', { buttons: 1 }) : true;
  // Focus moves on mousedown unless the page prevented it, to the nearest
  // focusable element under the pointer; with none, the old focus is lost.
  if (mouseDown) {
    var focusable = hit.closest('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])');
    if (focusable && focusable.disabled !== true) focusable.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  // The mousedown may have redrawn the widget; the release lands on what is
  // under the pointer now, and the click on what both halves share.
  var redrawn = document.elementFromPoint(x, y);
  var up = redrawn && target.contains(redrawn) ? redrawn : (target.isConnected ? target : hit);
  fire(up, Pointer, 'pointerup', {});
  if (pointerDown) fire(up, Mouse, 'mouseup', {});
  var clicked = up;
  if (hit.isConnected) {
    while (clicked && !clicked.contains(hit)) clicked = clicked.parentElement;
  }
  fire(clicked || up, Mouse, 'click', {});
  return { ok: true, clicked: cssPath(target), label: label(target), url: String(location.href) };
`);
var buildTypeScript = ({ selector, value, submit }) => wrap(`
  var selector = ${JSON.stringify(selector)};
  var value = ${JSON.stringify(value)};
  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };

  var editable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!editable) return { ok: false, error: selector + ' is not a text field' };
  if (target.disabled === true || target.readOnly === true) return { ok: false, error: 'Field is not editable' };

  target.scrollIntoView({ block: 'center' });
  target.focus();
  if (target.isContentEditable) {
    target.textContent = value;
  } else {
    // Frameworks track the value through the native setter; assigning the
    // property directly leaves React and friends unaware of the change.
    var prototype = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (setter && setter.set) setter.set.call(target, value);
    else target.value = value;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));

  if (${submit ? "true" : "false"}) {
    var enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    target.dispatchEvent(new KeyboardEvent('keydown', enter));
    target.dispatchEvent(new KeyboardEvent('keyup', enter));
    var form = target.form;
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  }
  return { ok: true, selector: cssPath(target), url: String(location.href) };
`);
var buildSelectScript = ({ selector, label: optionLabel, value }) => {
  const hasLabel = optionLabel !== undefined;
  const hasValue = value !== undefined;
  const criterion = hasLabel === hasValue ? "" : hasLabel ? "label" : "value";
  return wrap(`
  var selector = ${JSON.stringify(selector)};
  var criterion = ${JSON.stringify(criterion)};
  var wanted = ${JSON.stringify(hasLabel ? optionLabel : value)};
  if (!criterion) return { ok: false, error: 'browser.select requires exactly one of label or value' };

  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };
  if (!(target instanceof window.HTMLSelectElement)) return { ok: false, error: selector + ' is not a native HTML select' };
  if (isOptionDisabled(target)) return { ok: false, error: 'The select ' + selector + ' is disabled' };
  if (target.multiple) return { ok: false, error: 'Multiple selects are not supported for browser.select' };

  var matches = [];
  for (var i = 0; i < target.options.length; i += 1) {
    var option = target.options[i];
    var candidate = criterion === 'label' ? selectOptionLabel(option) : String(option.value);
    if (candidate === wanted) matches.push(option);
  }
  if (matches.length === 0) return { ok: false, error: 'No option in ' + selector + ' has the exact ' + criterion + ' ' + wanted };
  if (matches.length > 1) return { ok: false, error: 'More than one option in ' + selector + ' has the exact ' + criterion + ' ' + wanted };
  var match = matches[0];
  if (isOptionDisabled(match)) return { ok: false, error: 'The matching option in ' + selector + ' is disabled' };

  target.scrollIntoView({ block: 'center' });
  for (var j = 0; j < target.options.length; j += 1) target.options[j].selected = target.options[j] === match;
  var selected = target.selectedOptions;
  if (selected.length !== 1 || selected[0] !== match || target.value !== match.value) {
    return { ok: false, error: 'The option in ' + selector + ' could not be selected' };
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, selector: cssPath(target), label: selectOptionLabel(match), value: String(target.value), url: String(location.href) };
`);
};
var buildScrollScript = ({ selector, direction }) => wrap(`
  var selector = ${JSON.stringify(selector ?? "")};
  var direction = ${JSON.stringify(direction ?? "")};

  // Two frames let the layout catch up, but a page in a hidden background tab
  // is not composited and gets no frames at all while still reporting itself
  // visible, so the wait is capped by a timer. The scroll
  // itself is instant, so the position read then is already the final one.
  var settle = function (extra) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        var doc = document.documentElement;
        var maxScrollY = Math.max(0, doc.scrollHeight - window.innerHeight);
        var scrollY = Math.round(window.scrollY);
        var result = { ok: true, scrollY: scrollY, maxScrollY: Math.round(maxScrollY) };
        result.atTop = scrollY <= 1;
        result.atBottom = scrollY >= maxScrollY - 1;
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) result[key] = extra[key];
        }
        resolve(result);
      };
      requestAnimationFrame(function () {
        requestAnimationFrame(finish);
      });
      setTimeout(finish, ${SCROLL_SETTLE_MAX_MS});
    });
  };

  if (selector) {
    var target = null;
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
    if (!target) return { ok: false, error: 'No element matches ' + selector };
    // Instant on purpose: the page's own smooth scrolling would still be
    // animating when the next action runs against it.
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    return settle({ scrolledTo: cssPath(target) });
  }

  var doc = document.documentElement;
  var page = Math.round(window.innerHeight * 0.85);
  var bottom = Math.max(0, doc.scrollHeight - window.innerHeight);
  if (direction === 'down') window.scrollTo({ top: window.scrollY + page, behavior: 'instant' });
  else if (direction === 'up') window.scrollTo({ top: window.scrollY - page, behavior: 'instant' });
  else if (direction === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
  else if (direction === 'bottom') window.scrollTo({ top: bottom, behavior: 'instant' });
  else return { ok: false, error: 'Unknown scroll direction: ' + direction };
  return settle({ direction: direction });
`);
var INSPECTED_STYLE_PROPS = [
  "color",
  "background-color",
  "background-image",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "border-radius",
  "border-width",
  "border-style",
  "border-color",
  "box-shadow",
  "display",
  "position",
  "width",
  "height",
  "padding",
  "margin",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "z-index",
  "overflow",
  "visibility"
];
var buildInspectScript = ({ selector }) => wrap(`
  var selector = ${JSON.stringify(selector)};
  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };

  var computed = window.getComputedStyle(target);
  var styles = {};
  var props = ${JSON.stringify(INSPECTED_STYLE_PROPS)};
  for (var i = 0; i < props.length; i += 1) {
    var value = computed.getPropertyValue(props[i]);
    if (value) styles[props[i]] = String(value).trim();
  }

  var rect = target.getBoundingClientRect();
  return {
    ok: true,
    selector: cssPath(target),
    tag: target.tagName.toLowerCase(),
    label: label(target),
    bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
    styles: styles
  };
`);

// src/service/actions.ts
class BridgeState {
  lastTabs = new Map;
  viewports = new Map;
  unscopedId = `oc-unscoped-${randomBytes(4).toString("hex")}`;
  sessionId(sessionId, directory) {
    if (sessionId)
      return `oc-${sanitizeSessionId(sessionId)}`;
    if (directory)
      return `oc-dir-${createHash("sha256").update(directory).digest("hex").slice(0, 16)}`;
    return this.unscopedId;
  }
  lastTabId(sessionId) {
    return this.lastTabs.get(sessionId);
  }
  rememberTab(sessionId, tabId) {
    this.lastTabs.set(sessionId, tabId);
  }
  forgetTab(sessionId, tabId) {
    if (this.lastTabs.get(sessionId) === tabId)
      this.lastTabs.delete(sessionId);
    this.viewports.delete(tabId);
  }
  viewport(tabId) {
    return tabId ? this.viewports.get(tabId) : undefined;
  }
  rememberViewport(tabId, mode) {
    this.viewports.set(tabId, mode);
  }
}
function sanitizeSessionId(sessionId) {
  const cleaned = sessionId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "default").slice(0, 60);
}
var defaultState = new BridgeState;
var RESPONSE_MARGIN_MS = 1500;
var ACTION_START_BUDGET_MS = 4000;
var OPEN_START_BUDGET_MS = 6000;

class ActionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionError";
  }
}
async function ownTargets(relay, sessionId, deadline) {
  const targets = await relay.targets({ deadline, startBudgetMs: ACTION_START_BUDGET_MS });
  return targets.filter((target) => target.opencodeBrowserSessionId === sessionId);
}
async function requireOwnTarget(relay, sessionId, tabId, deadline) {
  const own = await ownTargets(relay, sessionId, deadline);
  const target = own.find((entry) => entry.id === tabId);
  if (!target) {
    throw new ActionError(`No tab ${tabId} in this session; call browser.snapshot to list tabs.`);
  }
  return target;
}
async function requireAndRemember(relay, state, sessionId, tabId, deadline) {
  await requireOwnTarget(relay, sessionId, tabId, deadline);
  state.rememberTab(sessionId, tabId);
}
function cleanError(text) {
  const trimmed = text.trim();
  return (trimmed || "browse could not complete the action.").slice(0, 2000);
}
function errorMessage(error) {
  return cleanError(error instanceof Error ? error.message : String(error));
}
function readWire(result) {
  if (result.isError)
    return { ok: false, error: cleanError(result.text) };
  const value = result.value;
  if (Object(value) !== value || value === null) {
    return { ok: false, error: "browse returned no result for this action." };
  }
  const wire = value;
  if (wire.ok === false) {
    return {
      ok: false,
      error: typeof wire.error === "string" && wire.error ? cleanError(wire.error) : "browse could not complete the action."
    };
  }
  if (wire.ok !== true || Object(wire.data) !== wire.data || wire.data === null) {
    return { ok: false, error: "browse returned an unexpected result." };
  }
  return { ok: true, data: wire.data };
}
var COMMON = `
const __oc = {
  async targetId(p) {
    const cdp = await p.context().newCDPSession(p);
    try {
      const info = await cdp.send('Target.getTargetInfo');
      const id = info && info.targetInfo && info.targetInfo.targetId;
      if (!id) throw new Error('Could not identify the tab');
      return id;
    } finally {
      await cdp.detach().catch(() => {});
    }
  },
  async select(tabId) {
    if (!tabId) {
      if (!page) throw new Error('No page is open in this session. Call browser.open first.');
      return page;
    }
    const pages = context.pages();
    for (const p of pages) {
      let id;
      try { id = await __oc.targetId(p); } catch (error) { continue; }
      if (id === tabId) return p;
    }
    throw new Error('No tab ' + tabId + ' in this session; call browser.snapshot to list tabs.');
  },
  async viewportSummary(p, mode) {
    if (mode === 'fill') return { mode: 'fill', width: null, height: null };
    const size = await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const resolved = mode || (size.width === 390 && size.height === 844 ? 'mobile'
      : size.width === 820 && size.height === 1180 ? 'tablet'
      : size.width === 1280 && size.height === 800 ? 'desktop'
      : 'custom');
    return { mode: resolved, width: size.width, height: size.height };
  },
  async applyViewport(p, mode) {
    if (!mode || mode === 'fill') {
      const cdp = await p.context().newCDPSession(p);
      try { await cdp.send('Emulation.clearDeviceMetricsOverride'); } finally { await cdp.detach().catch(() => {}); }
      return;
    }
    const sizes = {
      mobile: { width: 390, height: 844 },
      tablet: { width: 820, height: 1180 },
      desktop: { width: 1280, height: 800 }
    };
    const size = sizes[mode];
    if (!size) throw new Error('Unknown viewport ' + mode);
    await p.setViewportSize(size);
  }
};
`;
var tabArgument = (tabId) => JSON.stringify(tabId ?? null);
var modeArgument = (mode) => JSON.stringify(mode ?? null);
function openCode(parameters, tabId, mode) {
  const openPage = tabId ? `const p = await __oc.select(${JSON.stringify(tabId)});
const created = false;` : `const reused = page && page.url() === 'about:blank';
const p = reused ? page : await context.newPage();
const created = !reused;`;
  const closeOnError = tabId ? "" : "await p.close().catch(() => {});";
  return `
${COMMON}
const url = ${JSON.stringify(parameters.url)};
const viewport = ${JSON.stringify(parameters.viewport ?? null)};
const mode = ${modeArgument(mode)};
${openPage}
try {
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (error) {
  ${closeOnError}
  throw error;
}
let settled = true;
try { await p.waitForLoadState('networkidle', { timeout: 5000 }); } catch (error) { settled = false; }
if (viewport) await __oc.applyViewport(p, viewport);
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    tabId: id,
    url: p.url(),
    title: await p.title(),
    opened: true,
    settled,
    viewport: await __oc.viewportSummary(p, mode || (created ? 'fill' : null))
  }
};
`;
}
function snapshotCode(parameters, tabId, mode) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildSnapshotScript({ selector: parameters.selector }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Snapshot failed' };
const activeTabId = await __oc.targetId(p);
const data = {
  url: result.url,
  title: result.title,
  scope: result.scope,
  scrollY: result.scrollY,
  maxScrollY: result.maxScrollY,
  text: result.text,
  elements: result.elements,
  viewport: await __oc.viewportSummary(p, ${modeArgument(mode)}),
  activeTabId
};
if (result.textTruncated) data.textTruncated = true;
if (result.textTotalChars !== undefined) data.textTotalChars = result.textTotalChars;
if (result.elementsTruncated) data.elementsTruncated = true;
if (result.interactiveElementsOnPage !== undefined) data.interactiveElementsOnPage = result.interactiveElementsOnPage;
return { ok: true, data };
`;
}
function clickCode(parameters, tabId) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildClickScript({ selector: parameters.selector, text: parameters.text }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Click failed' };
return { ok: true, data: { clicked: result.clicked, label: result.label, url: result.url } };
`;
}
function typeCode(parameters, tabId) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildTypeScript({
    selector: parameters.selector,
    value: parameters.value,
    submit: parameters.submit
  }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Typing failed' };
return { ok: true, data: { selector: result.selector, url: result.url } };
`;
}
function selectCode(parameters, tabId) {
  const script = "label" in parameters ? buildSelectScript({ selector: parameters.selector, label: parameters.label }) : buildSelectScript({ selector: parameters.selector, value: parameters.value });
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(script)});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Selecting failed' };
return { ok: true, data: { selector: result.selector, label: result.label, value: result.value, url: result.url } };
`;
}
function scrollCode(parameters, tabId) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildScrollScript({ selector: parameters.selector, direction: parameters.direction }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Scrolling failed' };
const data = { scrollY: result.scrollY, maxScrollY: result.maxScrollY, atTop: result.atTop, atBottom: result.atBottom };
if (result.scrolledTo) data.scrolledTo = result.scrolledTo;
if (result.direction) data.direction = result.direction;
return { ok: true, data };
`;
}
function navigationCode(direction, tabId) {
  const call = direction === "back" ? "goBack" : "goForward";
  const label = direction === "back" ? "go back to" : "go forward to";
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const before = p.url();
const response = await p.${call}({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
if (!response && p.url() === before) return { ok: false, error: 'There is nothing to ${label} in this tab' };
return { ok: true, data: { url: p.url(), title: await p.title() } };
`;
}
function inspectCode(parameters, tabId) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildInspectScript({ selector: parameters.selector }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Inspect failed' };
return {
  ok: true,
  data: {
    selector: result.selector,
    tag: result.tag,
    label: result.label,
    bounds: result.bounds,
    inViewport: result.inViewport,
    styles: result.styles
  }
};
`;
}
function captureCode(tabId, mode) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
let buffer = await p.screenshot({ type: 'png' });
if (buffer.length > 8000000) buffer = await p.screenshot({ type: 'jpeg', quality: 80 });
const size = await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    image: buffer,
    width: size.width,
    height: size.height,
    url: p.url(),
    title: await p.title(),
    viewport: await __oc.viewportSummary(p, ${modeArgument(mode)}),
    tabId: id
  }
};
`;
}
function resizeCode(parameters, tabId) {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
await __oc.applyViewport(p, ${JSON.stringify(parameters.viewport)});
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    viewport: await __oc.viewportSummary(p, ${JSON.stringify(parameters.viewport)}),
    tabId: id
  }
};
`;
}
function closeCode(tabId) {
  return `
${COMMON}
const p = await __oc.select(${JSON.stringify(tabId)});
const id = await __oc.targetId(p);
await p.close();
return { ok: true, data: { closed: true, tabId: id } };
`;
}
async function run(relay, sessionId, code, timeoutMs, deadline, startBudgetMs) {
  return readWire(await relay.execute(code, { sessionId, timeoutMs, deadline, startBudgetMs }));
}
async function snapshotResult(relay, state, sessionId, parameters, tabId, deadline, startBudgetMs) {
  const result = await run(relay, sessionId, snapshotCode(parameters, tabId, state.viewport(tabId)), 18000, deadline, startBudgetMs);
  if (!result.ok)
    return result;
  const wire = result.data;
  const { activeTabId, ...data } = wire;
  if (activeTabId)
    state.rememberTab(sessionId, activeTabId);
  try {
    const own = await ownTargets(relay, sessionId, deadline);
    data.tabs = own.map((target) => ({
      id: target.id,
      title: target.id === activeTabId ? data.title : target.title,
      url: target.url,
      active: target.id === activeTabId
    }));
  } catch {}
  return { ok: true, data };
}
async function captureResult(relay, state, sessionId, tabId, timeoutMs, deadline, startBudgetMs) {
  const raw = await relay.execute(captureCode(tabId, state.viewport(tabId)), {
    sessionId,
    timeoutMs,
    deadline,
    startBudgetMs
  });
  const wire = readWire(raw);
  if (!wire.ok)
    return wire;
  const data = wire.data;
  if (data.tabId)
    state.rememberTab(sessionId, data.tabId);
  const media = raw.media?.[0];
  if (!media) {
    return { ok: false, error: "browse did not return the screenshot. Try browser.capture again." };
  }
  return {
    ok: true,
    data: {
      base64: media.data,
      mime: media.mimeType,
      width: data.width,
      height: data.height,
      url: data.url,
      title: data.title,
      viewport: data.viewport
    }
  };
}
async function handleBrowserAction(request, deps) {
  const state = deps.state ?? defaultState;
  const sessionId = state.sessionId(request.context.sessionId, request.context.directory);
  const tabId = request.parameters.tabId;
  let effectiveTabId = tabId;
  const hostLimitMs = request.action === "browser.open" ? BROWSER_PROVIDER_OPEN_TIMEOUT_MS : BROWSER_PROVIDER_ACTION_TIMEOUT_MS;
  const deadline = Date.now() + hostLimitMs - RESPONSE_MARGIN_MS;
  const startBudgetMs = request.action === "browser.open" ? OPEN_START_BUDGET_MS : ACTION_START_BUDGET_MS;
  try {
    if (request.action !== "browser.open" && !tabId) {
      const remembered = state.lastTabId(sessionId);
      if (remembered) {
        const own = await ownTargets(deps.relay, sessionId, deadline);
        if (own.some((target) => target.id === remembered)) {
          effectiveTabId = remembered;
        } else {
          state.forgetTab(sessionId, remembered);
        }
      }
    }
    switch (request.action) {
      case "browser.open": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        const mode = request.parameters.viewport ?? state.viewport(tabId);
        const result = await run(deps.relay, sessionId, openCode(request.parameters, tabId, mode), 40000, deadline, startBudgetMs);
        if (result.ok) {
          const data = result.data;
          if (data.tabId) {
            state.rememberTab(sessionId, data.tabId);
            if (mode)
              state.rememberViewport(data.tabId, mode);
            else if (data.viewport.mode !== "custom")
              state.rememberViewport(data.tabId, data.viewport.mode);
          }
        }
        return result;
      }
      case "browser.snapshot": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await snapshotResult(deps.relay, state, sessionId, request.parameters, effectiveTabId, deadline, startBudgetMs);
      }
      case "browser.click": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, clickCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.type": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, typeCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.select": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, selectCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.scroll": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, scrollCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.back":
      case "browser.forward": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, navigationCode(request.action === "browser.back" ? "back" : "forward", effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.inspect": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(deps.relay, sessionId, inspectCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
      }
      case "browser.capture": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await captureResult(deps.relay, state, sessionId, effectiveTabId, 18000, deadline, startBudgetMs);
      }
      case "browser.resize": {
        if (tabId)
          await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        const result = await run(deps.relay, sessionId, resizeCode(request.parameters, effectiveTabId), 18000, deadline, startBudgetMs);
        if (result.ok) {
          const data = result.data;
          if (data.tabId) {
            state.rememberTab(sessionId, data.tabId);
            state.rememberViewport(data.tabId, request.parameters.viewport);
          }
        }
        return result;
      }
      case "browser.close": {
        let targetId = effectiveTabId;
        if (targetId) {
          if (tabId)
            await requireOwnTarget(deps.relay, sessionId, tabId, deadline);
        } else {
          const own = await ownTargets(deps.relay, sessionId, deadline);
          const last = own[own.length - 1];
          if (!last)
            return { ok: false, error: "No tab in this session to close. Call browser.open first." };
          targetId = last.id;
        }
        const result = await run(deps.relay, sessionId, closeCode(targetId), 18000, deadline, startBudgetMs);
        if (result.ok)
          state.forgetTab(sessionId, targetId);
        return result;
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// src/service/browseRelay.ts
import { spawn } from "node:child_process";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";

// src/service/config.ts
import fs from "node:fs";
import path from "node:path";
var DEFAULTS = {
  browseBin: "browse",
  relayPort: 19988,
  browseHome: null,
  startRelay: true
};
function readBridgeConfig(extensionRoot) {
  const file = path.join(extensionRoot, "browse-bridge.json");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULTS };
  }
  if (Object(raw) !== raw || raw === null)
    return { ...DEFAULTS };
  const value = raw;
  const browseBin = typeof value.browseBin === "string" && value.browseBin.trim() ? value.browseBin.trim() : DEFAULTS.browseBin;
  const port = Number(value.relayPort);
  const relayPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.relayPort;
  const browseHome = typeof value.browseHome === "string" && value.browseHome.trim() ? path.resolve(value.browseHome.trim()) : null;
  const startRelay = value.startRelay === false ? false : DEFAULTS.startRelay;
  return { browseBin, relayPort, browseHome, startRelay };
}
function resolveBrowseBin(config) {
  if (config.browseBin !== DEFAULTS.browseBin)
    return config.browseBin;
  if (config.browseHome) {
    const candidate = path.join(config.browseHome, "bin", process.platform === "win32" ? "browse.exe" : "browse");
    if (fs.existsSync(candidate))
      return candidate;
  }
  return config.browseBin;
}

// src/service/browseRelay.ts
class RelayError extends Error {
  code;
  constructor(message, code = "RELAY_ERROR") {
    super(message);
    this.name = "RelayError";
    this.code = code;
  }
}
var DEFAULT_START_BUDGET_MS = 1e4;
var MIN_FETCH_TIMEOUT_MS = 500;
var VERSION_PROBE_MS = 1000;
function browseDataRoot(config) {
  if (config.browseHome)
    return config.browseHome;
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path2.isAbsolute(xdg) ? xdg : path2.join(os.homedir(), ".local", "share");
  return path2.join(base, "browse");
}
function relayTokenPath(config) {
  return path2.join(browseDataRoot(config), "relay-token");
}
function readToken(config) {
  try {
    const token = fs2.readFileSync(relayTokenPath(config), "utf8").trim();
    if (token)
      return token;
  } catch {}
  throw new RelayError(`browse relay token is missing at ${relayTokenPath(config)}. Start browse once so it creates the token, or set browseHome in browse-bridge.json.`, "RELAY_TOKEN_MISSING");
}
function browseEnv(config, base = process.env) {
  const env = { ...base };
  delete env.OPENCHAMBER_SERVICE_TOKEN;
  delete env.OPENCHAMBER_SERVICE_PORT;
  env.OPENCODE_BROWSER_PORT = String(config.relayPort);
  if (config.browseHome)
    env.OPENCODE_BROWSER_HOME = config.browseHome;
  return env;
}

class BrowseRelay {
  config;
  baseUrl;
  startingPromise = null;
  constructor(config) {
    this.config = config;
    this.baseUrl = `http://127.0.0.1:${config.relayPort}`;
  }
  async ensure(options = {}) {
    const now = Date.now();
    const deadline = options.deadline ?? now + DEFAULT_START_BUDGET_MS;
    if (await this.versionReachable(deadline))
      return;
    if (!this.startingPromise) {
      const startDeadline = Math.min(deadline, now + (options.startBudgetMs ?? DEFAULT_START_BUDGET_MS));
      this.startingPromise = this.startIfNeeded(startDeadline).finally(() => {
        this.startingPromise = null;
      });
    }
    return this.startingPromise;
  }
  async startIfNeeded(deadline) {
    if (await this.versionReachable(deadline))
      return;
    if (!this.config.startRelay) {
      throw new RelayError(`browse relay is not reachable at ${this.baseUrl}. Start it with \`browse serve\` or set startRelay to true in browse-bridge.json.`, "RELAY_UNREACHABLE");
    }
    const bin = resolveBrowseBin(this.config);
    const command = /\.(?:mjs|cjs|js)$/.test(bin) ? [process.execPath, bin] : [bin];
    let spawnError = null;
    try {
      const child = spawn(command[0], [...command.slice(1), "serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: browseEnv(this.config)
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("exit", (code, signal) => {
        if (code !== 0 || signal) {
          spawnError = new Error(`browse serve exited (code ${code}, signal ${signal})`);
        }
      });
      child.unref();
    } catch (error) {
      throw new RelayError(`Could not start browse: ${error instanceof Error ? error.message : String(error)}`, "RELAY_START_FAILED");
    }
    while (Date.now() < deadline) {
      if (await this.versionReachable(deadline))
        return;
      if (spawnError) {
        if (await this.versionReachable(deadline))
          return;
        throw this.spawnFailure(bin, spawnError);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new RelayError(`browse relay did not start at ${this.baseUrl} within the time limit. Run \`browse serve\` in a terminal to see why.`, "RELAY_START_TIMEOUT");
  }
  spawnFailure(bin, error) {
    const code = error.code;
    if (code === "ENOENT") {
      return new RelayError(`browse was not found at ${bin}. Install browse or set browseBin in browse-bridge.json.`, "BROWSE_NOT_FOUND");
    }
    return new RelayError(`Could not start browse: ${error.message}`, "RELAY_START_FAILED");
  }
  async versionReachable(deadline) {
    const remaining = deadline === undefined ? VERSION_PROBE_MS : deadline - Date.now();
    if (remaining <= 0)
      return false;
    try {
      const response = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(VERSION_PROBE_MS, remaining)))
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async execute(code, options) {
    await this.ensure(options);
    const token = readToken(this.config);
    const remaining = options.deadline === undefined ? options.timeoutMs + 5000 : options.deadline - Date.now();
    if (remaining <= 0) {
      throw new RelayError("The browse relay did not answer within the host time limit. The page may still be loading; try again.", "RELAY_TIMEOUT");
    }
    const relayTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(options.timeoutMs, remaining - 500));
    const fetchTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(options.timeoutMs + 5000, remaining));
    let response;
    try {
      response = await fetch(`${this.baseUrl}/cli/execute`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sessionId: options.sessionId,
          code,
          createIfMissing: true,
          timeoutMs: relayTimeoutMs
        }),
        signal: AbortSignal.timeout(fetchTimeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RelayError(timedOut ? `The browse relay did not answer within the time limit (${Math.round(fetchTimeoutMs / 1000)} s). The page may still be loading; try again.` : `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`, timedOut ? "RELAY_TIMEOUT" : "RELAY_UNREACHABLE");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new RelayError(`browse relay refused the action (${response.status}): ${text.slice(0, 500)}`, "RELAY_REJECTED");
    }
    return await response.json();
  }
  async targets(options = {}) {
    await this.ensure(options);
    const token = readToken(this.config);
    const remaining = options.deadline === undefined ? 5000 : options.deadline - Date.now();
    if (remaining <= 0) {
      throw new RelayError("The browse relay did not answer within the host time limit. Try again.", "RELAY_TIMEOUT");
    }
    const fetchTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(5000, remaining));
    let response;
    try {
      response = await fetch(`${this.baseUrl}/json/list`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(fetchTimeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RelayError(timedOut ? `The browse relay did not answer within the time limit (${Math.round(fetchTimeoutMs / 1000)} s). Try again.` : `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`, timedOut ? "RELAY_TIMEOUT" : "RELAY_UNREACHABLE");
    }
    if (!response.ok) {
      throw new RelayError(`browse relay refused the tab list (${response.status})`, "RELAY_REJECTED");
    }
    const value = await response.json();
    return Array.isArray(value) ? value : [];
  }
}

// src/service/main.ts
var extensionRoot = path3.join(path3.dirname(fileURLToPath(import.meta.url)), "..");
function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text)
  });
  response.end(text);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
function createBridgeServer(options) {
  return http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      sendJson(response, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname === BROWSER_PROVIDER_PATH && request.method === "POST") {
      let body;
      try {
        body = await readBody(request);
      } catch {
        sendJson(response, 400, { ok: false, error: "Request body is too large" });
        return;
      }
      const action = readBrowserProviderRequest(body);
      if (!action) {
        sendJson(response, 400, { ok: false, error: "Not a browser action" });
        return;
      }
      const result = await handleBrowserAction(action, { relay: options.relay });
      sendJson(response, 200, result);
      return;
    }
    sendJson(response, 404, { ok: false, error: "not-found" });
  });
}
async function main() {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
  if (!port || !token) {
    console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
    process.exit(1);
  }
  const config = readBridgeConfig(extensionRoot);
  const relay = new BrowseRelay(config);
  const server = createBridgeServer({ relay, token });
  server.on("error", (error) => {
    console.error(`browse bridge could not listen on 127.0.0.1:${port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`browse bridge listening on 127.0.0.1:${port}`);
  });
}
if (process.argv[1] && path3.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
export {
  createBridgeServer
};
