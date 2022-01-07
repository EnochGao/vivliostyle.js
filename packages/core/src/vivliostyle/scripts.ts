/**
 * Copyright 2022 Vivliostyle Foundation
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview Scripts - Supports JavaScript in source document.
 */
import * as CssStyler from "./css-styler";
import * as Task from "./task";
import * as Logging from "./logging";
import * as TaskUtil from "./task-util";

/**
 * Enable or disable JavaScript in html support
 */
export let allowScripts = true;
export function setAllowScripts(value: boolean): void {
  allowScripts = value;
}

const deferredScripts: HTMLScriptElement[] = [];

function sameScripts(s1: HTMLScriptElement, s2: HTMLScriptElement): boolean {
  return (
    s1 === s2 ||
    (s1.src || s2.src ? s1.src === s2.src : s1.textContent === s2.textContent)
  );
}

export function loadScript(
  srcScriptElem: HTMLScriptElement,
  window: Window,
  flags?: { inHead?: boolean; atEnd?: boolean; forceDefer?: boolean },
): Task.Result<boolean> {
  if (!allowScripts) {
    return Task.newResult(false);
  }
  if (
    !flags?.inHead &&
    !flags?.atEnd &&
    Array.from(
      srcScriptElem.ownerDocument.querySelectorAll(
        "body > script:not(:not(script, link, style) ~ *)",
      ),
    ).includes(srcScriptElem)
  ) {
    // The script elements at beginning of body have already been processed.
    return Task.newResult(false);
  }

  const scriptContent = srcScriptElem.textContent;
  const src = srcScriptElem.src;
  const isModule = srcScriptElem.type === "module";
  const async = (isModule || src) && srcScriptElem.async;
  const defer = (isModule && !async) || (src && srcScriptElem.defer);
  const needDefer = !flags?.atEnd && (flags?.forceDefer || defer || async);

  if (!hasScripts(window)) {
    // `window.onload = startViewer`, which was set by vivliostyle-viewer,
    // has to be unset to prevent `startViewer` restarting because of
    // `window.dispatchEvent(new Event("load"))` in `loadScriptsAtEnd()`.
    window.onload = null;
  }

  if (needDefer) {
    if (!deferredScripts.some((s) => sameScripts(s, srcScriptElem))) {
      deferredScripts.push(srcScriptElem);
    }
    return Task.newResult(true);
  }

  if (src.includes("/mathjax")) {
    const builtinMathJax2 = window.document.head.querySelector(
      "script[src*='MathJax.js']:not([data-vivliostyle-scripting])",
    );
    if (builtinMathJax2) {
      if (src.includes("/mathjax@3")) {
        // Remove the builtin MathJax 2 when MathJax 3 is specified
        window.document.head.removeChild(builtinMathJax2);
        if (window["MathJax"]?.version?.startsWith("2.")) {
          delete window["MathJax"];
        }
      } else if (src.includes("/MathJax.js")) {
        // Ignore the specified MathJax 2, and use the builtin MathJax 2
        return Task.newResult(true);
      }
    }
  }

  for (const s of window.document.head.getElementsByTagName("script")) {
    if (
      s.hasAttribute("data-vivliostyle-scripting") &&
      sameScripts(s, srcScriptElem)
    ) {
      // If same script is already loaded, remove the already loaded one before load the new one.
      window.document.head.removeChild(s);
    }
  }

  const scriptElem = window.document.createElement("script");
  scriptElem.textContent = scriptContent;
  if (src) {
    scriptElem.src = src;
  }
  scriptElem.async = async;
  scriptElem.defer = defer;
  scriptElem.setAttribute("data-vivliostyle-scripting", "true");

  for (const attr of srcScriptElem.attributes) {
    if (!["src", "async", "defer"].includes(attr.name)) {
      scriptElem.setAttribute(attr.name, attr.value);
    }
  }
  Logging.logger.info("script:", src);
  if (!src) {
    window.document.head.appendChild(scriptElem);
    return Task.newResult(true);
  } else {
    const fetcher = TaskUtil.loadElement(scriptElem);
    window.document.head.appendChild(scriptElem);
    return TaskUtil.waitForFetchers([fetcher]);
  }
}

function getFontFamilyListFromStyler(styler: CssStyler.Styler): string {
  const fontFamilySet = {};
  for (const style of Object.values(styler.styleMap)) {
    const family = style["font-family"]?.value;
    if (family) {
      if (family.values) {
        for (const family1 of family.values) {
          fontFamilySet[family1.stringValue()] = true;
        }
      } else {
        fontFamilySet[family.stringValue()] = true;
      }
    }
  }
  return Object.keys(fontFamilySet).join(",");
}

function prepareTextContentForWebFonts(
  srcDocument: Document,
  window: Window,
  styler: CssStyler.Styler,
): HTMLElement {
  const textContentDiv: HTMLElement =
    window.document.querySelector("[data-vivliostyle-textcontent]") ??
    window.document.createElement("div");
  textContentDiv.style.position = "fixed";
  textContentDiv.style.fontSize = "0";
  textContentDiv.setAttribute("data-vivliostyle-textcontent", "true");
  textContentDiv.setAttribute("aria-hidden", "true");
  textContentDiv.style.fontFamily = getFontFamilyListFromStyler(styler);
  textContentDiv.textContent = srcDocument.documentElement.textContent;
  window.document.body.appendChild(textContentDiv);
  return textContentDiv;
}

function isWebFontLoading(window: Window): boolean {
  // Check font-face loading status or the "wf-loading" class set by Typekit Web Font Loader
  return (
    (window.document as any).fonts.status === "loading" ||
    /\bwf-loading\b/.test(window.document.documentElement.className)
  );
}

export function loadScriptsInHead(
  srcDocument: Document,
  window: Window,
  styler: CssStyler.Styler,
): Task.Result<boolean> {
  if (!allowScripts) {
    return Task.newResult(false);
  }
  // Process script elements in head and also beginning of body
  const srcScripts: HTMLScriptElement[] = Array.from(
    srcDocument.querySelectorAll(
      "head > script, body > script:not(:not(script, link, style) ~ *)",
    ),
  );
  if (srcScripts.length === 0) {
    return Task.newResult(false);
  }
  const needPrepareForWebFonts = srcScripts.some(
    (s) => !(s.async || s.defer || s.type === "module"),
  );

  // Web fonts needs text content of the document
  const textContentDiv = needPrepareForWebFonts
    ? prepareTextContentForWebFonts(srcDocument, window, styler)
    : null;
  const savedDollar = window["$"];
  let forceDefer = false;
  const frame: Task.Frame<boolean> = Task.newFrame("loadScripts");
  frame
    .loop(() => {
      if (srcScripts.length === 0) {
        return frame.sleep(10).thenAsync(() => {
          if (isWebFontLoading(window)) {
            return frame.sleep(100).thenReturn(true); // continue
          }
          return Task.newResult(false); // break
        });
      }
      const srcScriptElem = srcScripts.shift();
      return loadScript(srcScriptElem, window, {
        inHead: true,
        forceDefer,
      }).thenAsync(() => {
        if (!forceDefer && window["$"] !== savedDollar) {
          // jQuery `$(…)` does not work before document is loaded, so need to defer
          deferredScripts.push(srcScriptElem);
          forceDefer = true;
        }
        if (srcScripts.length === 0) {
          if (needPrepareForWebFonts) {
            // Some web font loaders (DynaFont, FONTPLUS) need DOMContentLoaded event
            window.document.dispatchEvent(new Event("DOMContentLoaded"));
          }
        }
        return Task.newResult(true); // continue
      });
    })
    .then(() => {
      if (textContentDiv) {
        textContentDiv.remove();
      }
      frame.finish(true);
    });
  return frame.result();
}

export function loadScriptsAtEnd(window: Window): Task.Result<boolean> {
  if (!allowScripts) {
    return Task.newResult(false);
  }
  const frame: Task.Frame<boolean> = Task.newFrame("loadScripts");
  frame
    .loop(() => {
      if (deferredScripts.length === 0) {
        return Task.newResult(false);
      }
      return loadScript(deferredScripts.shift(), window, {
        atEnd: true,
      }).thenReturn(deferredScripts.length > 0);
    })
    .then(() => {
      window.dispatchEvent(new Event("DOMContentLoaded"));
      window.dispatchEvent(new Event("load"));
      frame.finish(true);
    });
  return frame.result();
}

export function hasScripts(window: Window) {
  if (!allowScripts) {
    return false;
  }
  return (
    deferredScripts.length > 0 ||
    !!window.document.head.querySelector("script[data-vivliostyle-scripting]")
  );
}
